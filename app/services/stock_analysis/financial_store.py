"""Persistent statements with stale-while-revalidate reads and shared refreshes."""
import asyncio
import logging
from datetime import datetime, timedelta, timezone

from elasticsearch import BadRequestError, NotFoundError
from yfinance.exceptions import YFRateLimitError

from services.db import get_es
from services.stock_analysis.financials import fetch_financials, STATEMENT_METRICS
from services.stock_analysis.symbols import is_market_index, public_symbol

FINANCIALS_INDEX = 'stock_financials'
FRESH_SECONDS = 24 * 60 * 60
RETRY_SECONDS = 15 * 60
MANUAL_REFRESH_SECONDS = 60
REQUEST_INTERVAL_SECONDS = 2
RATE_LIMIT_SECONDS = 120
logger = logging.getLogger(__name__)
_refreshes: dict[tuple[str, str], asyncio.Task] = {}
_provider_lock = asyncio.Lock()
_next_request = 0.0


def utc_now():
    return datetime.now(timezone.utc)


async def ensure_store(es):
    if await es.indices.exists(index=FINANCIALS_INDEX):
        return
    try:
        await es.indices.create(index=FINANCIALS_INDEX,
                                settings={'number_of_shards': 1, 'number_of_replicas': 0},
                                mappings={'properties': {'payload': {'type': 'object', 'enabled': False}}})
    except BadRequestError as exc:
        if exc.error != 'resource_already_exists_exception':
            raise


async def read_document(key):
    es = get_es()
    try:
        await ensure_store(es)
        try:
            return (await es.get(index=FINANCIALS_INDEX, id=key))['_source']['payload']
        except NotFoundError:
            return None
    finally:
        await es.close()


async def write_document(key, data):
    es = get_es()
    try:
        await ensure_store(es)
        await es.index(index=FINANCIALS_INDEX, id=key, document={'payload': data})
    finally:
        await es.close()


def is_fresh(data):
    checked = (data or {}).get('checkedAt')
    return bool(checked and (utc_now() - datetime.fromisoformat(checked)).total_seconds() < FRESH_SECONDS)


def merge_statements(previous, fresh):
    """Keep periods that have rolled out of Yahoo's response and valid old cells."""
    result = {}
    for kind in STATEMENT_METRICS:
        periods = {row['period']: row for row in (previous or {}).get('statements', {}).get(kind, [])}
        for row in fresh['statements'][kind]:
            old_values = periods.get(row['period'], {}).get('values', {})
            periods[row['period']] = {'period': row['period'], 'values': {
                **old_values, **{key: value if value is not None else old_values.get(key)
                                for key, value in row['values'].items()},
            }}
        result[kind] = sorted(periods.values(), key=lambda row: row['period'], reverse=True)
    return result


async def _refresh(symbol, frequency):
    global _next_request
    key = f'data:{symbol}:{frequency}'
    previous = await read_document(key)
    try:
        # One provider request at a time across interactive and bulk jobs.
        async with _provider_lock:
            loop = asyncio.get_running_loop()
            await asyncio.sleep(max(0, _next_request - loop.time()))
            try:
                fresh = await asyncio.to_thread(fetch_financials, symbol, frequency, force=True)
            except YFRateLimitError:
                _next_request = loop.time() + RATE_LIMIT_SECONDS
                raise
            finally:
                _next_request = max(_next_request, loop.time() + REQUEST_INTERVAL_SECONDS)
        has_data = any(row.get('values') and any(value is not None for value in row['values'].values())
                       for rows in fresh['statements'].values() for row in rows)
        if not has_data and previous and previous.get('availability') == 'available':
            raise ValueError('Empty provider response for previously available financials')
        currency_changed = (previous and previous.get('currency') and fresh.get('currency')
                            and previous['currency'] != fresh['currency'])
        if currency_changed:
            raise ValueError('Financial currency changed; refusing to merge incompatible history')
        result = {
            'currency': fresh.get('currency') or (previous or {}).get('currency'),
            'statements': merge_statements(previous, fresh),
            'checkedAt': utc_now().isoformat(), 'attemptedAt': utc_now().isoformat(),
            'availability': 'available' if has_data else 'empty', 'refreshFailed': False,
        }
        await write_document(key, result)
        return result
    except Exception:
        # Persist a retry cooldown even when the first fetch fails.
        failed = {**(previous or {}), 'attemptedAt': utc_now().isoformat(), 'refreshFailed': True}
        await write_document(key, failed)
        raise


def _finished(key, task):
    _refreshes.pop(key, None)
    if not task.cancelled() and task.exception():
        logger.warning('Financial refresh failed for %s', key)


async def get_financials(symbol, frequency, *, force=False, wait=False):
    if is_market_index(symbol):
        return {'currency': None, 'statements': {kind: [] for kind in STATEMENT_METRICS}, 'refreshing': False}
    symbol = public_symbol(symbol)
    key = (symbol, frequency)
    data = await read_document(f'data:{symbol}:{frequency}')
    attempted = (data or {}).get('attemptedAt')
    retry_seconds = RETRY_SECONDS if (data or {}).get('refreshFailed') and not force else MANUAL_REFRESH_SECONDS
    cooldown = bool(attempted and utc_now() - datetime.fromisoformat(attempted) < timedelta(seconds=retry_seconds))
    task = _refreshes.get(key)
    if task is None and (force or not is_fresh(data)) and not cooldown:
        task = asyncio.create_task(_refresh(symbol, frequency))
        _refreshes[key] = task
        task.add_done_callback(lambda done: _finished(key, done))
    has_snapshot = data is not None and 'statements' in data
    if task is not None and (wait or not has_snapshot):
        try:
            data = await asyncio.shield(task)
        except Exception:
            if wait or not has_snapshot:
                raise
        task = None
    if not data or 'statements' not in data:
        raise ValueError('Financial statements temporarily unavailable')
    return {**data, 'refreshing': task is not None and not task.done()}


async def stop_refreshes():
    tasks = list(_refreshes.values())
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
