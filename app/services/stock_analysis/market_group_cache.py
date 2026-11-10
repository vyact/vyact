"""Persist the US map's sector/industry membership separately from live quotes."""
import csv
import json
import logging
import os
import tempfile
import threading
from datetime import datetime
from time import monotonic
from zoneinfo import ZoneInfo

import httpx

from config import INSTALL_DIR
from services.stock_analysis.industry_classification import fetch_us_industries

IVV_HOLDINGS_URL = 'https://www.ishares.com/us/products/239726/ishares-core-s-p-500-etf/latest-holdings.csv'
GROUP_CACHE_FILE = INSTALL_DIR / 'cache' / 'stock-analysis-us-groups.json'
GROUP_TIMEZONE = ZoneInfo('America/New_York')
GROUP_RETRY_SECONDS = 15 * 60
MINIMUM_GROUP_SYMBOLS = 400
logger = logging.getLogger(__name__)
_cached = None
_disk_loaded = False
_next_retry = 0.0
_group_lock = threading.Lock()


def _today():
    return datetime.now(GROUP_TIMEZONE).date().isoformat()


def parse_us_holdings(text, industries):
    lines = text.lstrip('\ufeff').splitlines()
    header = next(index for index, line in enumerate(lines) if line.startswith('Ticker,'))
    date_label = next(row[1] for row in csv.reader(lines[:header]) if row and row[0] == 'Fund Holdings as of')
    groups = {}
    seen = set()
    for row in csv.DictReader(lines[header:]):
        if row.get('Asset Class') != 'Equity':
            continue
        symbol = (row.get('Ticker') or '').strip().replace('.', '-').replace('/', '-').replace(' ', '-')
        sector = (row.get('Sector') or '').strip()
        if not symbol or not sector or symbol in seen:
            continue
        seen.add(symbol)
        groups.setdefault(sector, []).append({'symbol': symbol, 'name': row.get('Name') or symbol,
                                             'industry': industries.get(symbol)})
    return {'version': 1, 'date': datetime.strptime(date_label, '%b %d, %Y').date().isoformat(),
            'checkedDate': _today(), 'groups': groups}


def _valid(snapshot):
    if not isinstance(snapshot, dict) or snapshot.get('version') != 1 or not isinstance(snapshot.get('groups'), dict):
        return False
    try:
        datetime.fromisoformat(snapshot['date'])
        datetime.fromisoformat(snapshot['checkedDate'])
        stocks = [stock for entries in snapshot['groups'].values() for stock in entries]
        return len(stocks) >= MINIMUM_GROUP_SYMBOLS and all(
            isinstance(stock.get('symbol'), str) and isinstance(stock.get('name'), str)
            and (stock.get('industry') is None or isinstance(stock['industry'], str)) for stock in stocks)
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def _save(snapshot):
    GROUP_CACHE_FILE.parent.mkdir(parents=True, exist_ok=True)
    path = None
    try:
        with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', dir=GROUP_CACHE_FILE.parent, delete=False) as handle:
            path = handle.name
            json.dump(snapshot, handle, ensure_ascii=False)
        os.replace(path, GROUP_CACHE_FILE)
    finally:
        if path and os.path.exists(path):
            os.unlink(path)


def get_us_market_groups(client: httpx.Client):
    global _cached, _disk_loaded, _next_retry
    with _group_lock:
        if not _disk_loaded:
            try:
                saved = json.loads(GROUP_CACHE_FILE.read_text(encoding='utf-8'))
                if _valid(saved):
                    _cached = saved
            except (OSError, ValueError):
                pass
            _disk_loaded = True
        if _cached and _cached['checkedDate'] == _today():
            return _cached
        if monotonic() < _next_retry:
            if _cached:
                return _cached
            raise ValueError('Market groups temporarily unavailable')
        try:
            # Both sources must succeed before replacing yesterday's membership.
            holdings = client.get(IVV_HOLDINGS_URL)
            holdings.raise_for_status()
            industries = fetch_us_industries(client)
            fresh = parse_us_holdings(holdings.text, industries)
            if not _valid(fresh):
                raise ValueError('Incomplete US market groups')
            try:
                _save(fresh)
            except OSError:
                logger.warning('Unable to persist daily market groups; using the in-memory snapshot')
            _cached = fresh
            _next_retry = 0.0
        except Exception:
            logger.warning('Market group refresh failed; keeping the last successful membership')
            _next_retry = monotonic() + GROUP_RETRY_SECONDS
            if not _cached:
                raise
        return _cached
