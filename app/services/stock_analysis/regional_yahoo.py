import json
import re
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache, partial
from time import monotonic

import yfinance as yf
from yfinance.data import YfData

YAHOO_SECTORS = (
    'Technology', 'Financial Services', 'Consumer Cyclical', 'Communication Services',
    'Healthcare', 'Consumer Defensive', 'Industrials', 'Energy', 'Basic Materials', 'Utilities', 'Real Estate',
)
REGIONAL_SYMBOL_PATTERNS = {
    'KR': r'[0-9][A-Z0-9]{5}\.(KS|KQ)', 'JP': r'[0-9][A-Z0-9]{3}\.T',
    'TW': r'[0-9]{4}\.(TW|TWO)', 'HK': r'[0-9]{4,5}\.HK',
    'CN': r'[036][0-9]{5}\.(SS|SZ)',
}
REGIONAL_EXCHANGES = {'TW': ('TAI', 'TWO'), 'HK': ('HKG',), 'CN': ('SHH', 'SHZ')}
DIRECTORY_PAGE_SIZE = 250
DIRECTORY_CACHE_SECONDS = 3600
SECTOR_STOCK_LIMIT = 15
SCREENER_URL = 'https://query1.finance.yahoo.com/v1/finance/screener'
_korea_provider_symbols: dict[str, str] = {}
_korea_provider_symbols_loaded_at = 0.0


def _screen(sector: str | None = None, offset: int = 0, size: int = DIRECTORY_PAGE_SIZE, language: str = 'en', region: str = 'KR') -> dict:
    query = yf.EquityQuery('eq', ['region', region.lower()])
    if region in REGIONAL_EXCHANGES:
        query = yf.EquityQuery('and', [query, yf.EquityQuery('is-in', ['exchange', *REGIONAL_EXCHANGES[region]]),
                                      yf.EquityQuery('gt', ['intradaymarketcap', 0])])
    if sector:
        query = yf.EquityQuery('and', [query, yf.EquityQuery('eq', ['sector', sector])])
    # Localize names in the directory response itself, without a second quote pass.
    response = YfData().post(SCREENER_URL, data=json.dumps({
        'query': query.to_dict(), 'quoteType': 'EQUITY', 'offset': offset, 'size': size,
        'sortField': 'intradaymarketcap', 'sortType': 'DESC', 'userId': '', 'userIdType': 'guid',
    }), params={'lang': {'ko': 'ko-KR', 'ja': 'ja-JP', 'zh': {'TW': 'zh-TW', 'HK': 'zh-HK', 'CN': 'zh-CN'}.get(region, 'zh-CN')}.get(language, 'en-US'), 'region': region,
                'formatted': 'false', 'corsDomain': 'finance.yahoo.com'}, timeout=15)
    response.raise_for_status()
    return response.json()['finance']['result'][0]


def _directory_page(arguments: tuple[int, str, str]) -> list[dict]:
    offset, language, region = arguments
    return _screen(offset=offset, language=language, region=region).get('quotes', [])


@lru_cache(maxsize=16)
def _directory(cache_hour: int, language: str, region: str = 'KR') -> dict[str, dict]:
    global _korea_provider_symbols, _korea_provider_symbols_loaded_at
    first = _screen(language=language, region=region)
    quotes = list(first.get('quotes', []))
    offsets = range(DIRECTORY_PAGE_SIZE, first.get('total', len(quotes)), DIRECTORY_PAGE_SIZE)
    with ThreadPoolExecutor(max_workers=4) as executor:
        for page in executor.map(_directory_page, [(offset, language, region) for offset in offsets]):
            quotes.extend(page)
    records = {quote['symbol']: quote for quote in quotes
               if re.fullmatch(REGIONAL_SYMBOL_PATTERNS[region], quote.get('symbol', ''))}
    if not records:
        raise ValueError(f'Yahoo returned no {region} listings')
    if region == 'KR':
        _korea_provider_symbols = {symbol.rsplit('.', 1)[0]: symbol for symbol in records}
        _korea_provider_symbols_loaded_at = monotonic()
    return records


def cached_korea_provider_symbol(code: str) -> str | None:
    if monotonic() - _korea_provider_symbols_loaded_at < DIRECTORY_CACHE_SECONDS:
        return _korea_provider_symbols.get(code)
    return None


def _names(records: dict[str, dict], native: bool = False) -> dict[str, str]:
    # Yahoo may return a native longName even when English was requested.
    # The shortName provides the English fallback for both Korean and Japanese listings.
    primary, fallback = ('longName', 'shortName') if native else ('shortName', 'longName')
    return {symbol: record.get(primary) or record.get(fallback) or symbol for symbol, record in records.items()}


def korea_symbols(cache_hour: int) -> dict[str, str]:
    return _names(_directory(cache_hour, 'en'))


def korea_display_names(language: str = 'en') -> dict[str, str]:
    language = 'ko' if language.lower().split('-')[0] == 'ko' else 'en'
    return _names(_directory(int(monotonic() // DIRECTORY_CACHE_SECONDS), language), native=language == 'ko')


def korea_preferred_symbols(language: str = 'en') -> set[str]:
    language = 'ko' if language.lower().split('-')[0] == 'ko' else 'en'
    records = _directory(int(monotonic() // DIRECTORY_CACHE_SECONDS), language)
    return {symbol for symbol, record in records.items()
            if re.search(r'\(\d*P\)', record.get('shortName', ''), re.IGNORECASE)}


def _sector_members(sector: str, region: str = 'KR') -> tuple[str, list[str]]:
    # Same common-share universe as vyvow; paginate until 15 eligible stocks.
    symbols = []
    offset = 0
    while len(symbols) < SECTOR_STOCK_LIMIT:
        page = _screen(sector, offset=offset, region=region)
        quotes = page.get('quotes', [])
        symbols.extend(quote['symbol'] for quote in quotes
                       if re.fullmatch(r'[0-9]{5}0\.(KS|KQ)' if region == 'KR' else REGIONAL_SYMBOL_PATTERNS[region], quote.get('symbol', '')))
        offset += len(quotes)
        if not quotes or offset >= page.get('total', offset):
            break
    return sector, symbols[:SECTOR_STOCK_LIMIT]


@lru_cache(maxsize=8)
def _load_sector_members(cache_hour: int, region: str = 'KR') -> dict[str, list[str]]:
    with ThreadPoolExecutor(max_workers=4) as executor:
        return dict(executor.map(partial(_sector_members, region=region), YAHOO_SECTORS))


def get_korea_sector_members() -> dict[str, list[str]]:
    return _load_sector_members(int(monotonic() // DIRECTORY_CACHE_SECONDS))


def japan_display_names(language: str = 'en') -> dict[str, str]:
    language = 'ja' if language.lower().split('-')[0] == 'ja' else 'en'
    return _names(_directory(int(monotonic() // DIRECTORY_CACHE_SECONDS), language, 'JP'), native=language == 'ja')


def get_japan_sector_members() -> dict[str, list[str]]:
    return _load_sector_members(int(monotonic() // DIRECTORY_CACHE_SECONDS), 'JP')


def regional_display_names(market: str, language: str = 'en') -> dict[str, str]:
    if market == 'KR':
        return korea_display_names(language)
    if market == 'JP':
        return japan_display_names(language)
    language = 'zh' if language.lower().replace('_', '-').split('-')[0] == 'zh' else 'en'
    return _names(_directory(int(monotonic() // DIRECTORY_CACHE_SECONDS), language, market), native=language == 'zh')


def regional_sector_members(market: str) -> dict[str, list[str]]:
    return _load_sector_members(int(monotonic() // DIRECTORY_CACHE_SECONDS), market)
