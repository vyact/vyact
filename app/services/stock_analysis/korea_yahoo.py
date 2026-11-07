import logging
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from time import monotonic

import yfinance as yf
from yfinance.data import YfData

logger = logging.getLogger(__name__)

KOREA_SECTORS = (
    'Technology', 'Financial Services', 'Consumer Cyclical', 'Communication Services',
    'Healthcare', 'Consumer Defensive', 'Industrials', 'Energy', 'Basic Materials', 'Utilities', 'Real Estate',
)
DIRECTORY_PAGE_SIZE = 250
DIRECTORY_CACHE_SECONDS = 3600
SECTOR_STOCK_LIMIT = 15


def _screen(sector: str | None = None, offset: int = 0, size: int = DIRECTORY_PAGE_SIZE) -> dict:
    query = yf.EquityQuery('eq', ['region', 'kr'])
    if sector:
        query = yf.EquityQuery('and', [query, yf.EquityQuery('eq', ['sector', sector])])
    return yf.screen(query, offset=offset, size=size, sortField='intradaymarketcap', sortAsc=False)


@lru_cache(maxsize=2)
def korea_symbols(cache_hour: int) -> dict[str, str]:
    symbols = {}
    offset = 0
    while True:
        page = _screen(offset=offset)
        quotes = page.get('quotes', [])
        for quote in quotes:
            symbol = quote.get('symbol', '')
            if symbol.endswith(('.KS', '.KQ')):
                symbols[symbol] = quote.get('longName') or quote.get('shortName') or symbol
        offset += len(quotes)
        if not quotes or offset >= page.get('total', offset):
            break
    if not symbols:
        raise ValueError('Yahoo returned no Korean listings')
    return symbols


def _sector_members(sector: str) -> tuple[str, list[str]]:
    page = _screen(sector, size=SECTOR_STOCK_LIMIT)
    return sector, [quote['symbol'] for quote in page.get('quotes', []) if quote.get('symbol', '').endswith(('.KS', '.KQ'))]


@lru_cache(maxsize=2)
def _load_sector_members(cache_hour: int) -> dict[str, list[str]]:
    with ThreadPoolExecutor(max_workers=4) as executor:
        return dict(executor.map(_sector_members, KOREA_SECTORS))


def get_korea_sector_members() -> dict[str, list[str]]:
    return _load_sector_members(int(monotonic() // DIRECTORY_CACHE_SECONDS))


YAHOO_QUOTE_URL = 'https://query1.finance.yahoo.com/v7/finance/quote'
NAME_BATCH_SIZE = 100


def _korean_name_batch(symbols: list[str]) -> dict[str, str]:
    try:
        response = YfData().get_raw_json(YAHOO_QUOTE_URL, params={
            'symbols': ','.join(symbols), 'lang': 'ko-KR', 'region': 'KR', 'formatted': 'false',
        }, timeout=15)
        return {quote['symbol']: quote['longName'] for quote in response['quoteResponse']['result']
                if quote.get('symbol') and quote.get('longName')}
    except Exception as exc:
        logger.warning("Korean Yahoo names unavailable: %s", exc)
        return {}


@lru_cache(maxsize=2)
def _korean_display_names(cache_hour: int) -> dict[str, str]:
    names = dict(korea_symbols(cache_hour))
    symbols = list(names)
    batches = [symbols[offset:offset + NAME_BATCH_SIZE] for offset in range(0, len(symbols), NAME_BATCH_SIZE)]
    with ThreadPoolExecutor(max_workers=4) as executor:
        for result in executor.map(_korean_name_batch, batches):
            names.update(result)
    return names


def korea_display_names(language: str = 'en') -> dict[str, str]:
    cache_hour = int(monotonic() // DIRECTORY_CACHE_SECONDS)
    return _korean_display_names(cache_hour) if language.lower().split('-')[0] == 'ko' else korea_symbols(cache_hour)
