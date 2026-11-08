"""Provider-independent Korean stock codes and Yahoo symbol conversion."""
import re
from time import monotonic

from services.stock_analysis.market_indices import INDEX_SYMBOLS, MARKET_INDEX_SYMBOLS
from services.stock_analysis.korea_yahoo import DIRECTORY_CACHE_SECONDS, cached_korea_provider_symbol, korea_symbols

KOREAN_CODE_PATTERN = re.compile(r'^[0-9][A-Z0-9]{5}$')
KOREAN_YAHOO_PATTERN = re.compile(r'^([0-9][A-Z0-9]{5})\.(KS|KQ)$')
YAHOO_EXCHANGES = {'KS': 'KOSPI', 'KQ': 'KOSDAQ'}
PUBLIC_INDEX_CODES = frozenset(symbol.removeprefix('^') for symbol in INDEX_SYMBOLS)
KOREAN_INDEX_CODES = frozenset(symbol.removeprefix('^') for symbol in MARKET_INDEX_SYMBOLS['KR'])


def public_symbol(symbol: str) -> str:
    match = KOREAN_YAHOO_PATTERN.fullmatch(symbol)
    if match:
        return match[1]
    return symbol.removeprefix('^') if symbol.removeprefix('^') in PUBLIC_INDEX_CODES else symbol


def symbol_market(symbol: str) -> str:
    code = public_symbol(symbol)
    return 'KR' if KOREAN_CODE_PATTERN.fullmatch(code) or code in KOREAN_INDEX_CODES else 'US'


def is_market_index(symbol: str) -> bool:
    return public_symbol(symbol) in PUBLIC_INDEX_CODES


def normalize_market_indices(indices: list[dict]) -> list[dict]:
    return [{**item, 'symbol': public_symbol(item['symbol'])} for item in indices]


def normalize_stock(stock: dict) -> dict:
    symbol = stock['symbol']
    match = KOREAN_YAHOO_PATTERN.fullmatch(symbol)
    result = {**stock, 'symbol': public_symbol(symbol)}
    exchange = YAHOO_EXCHANGES[match[2]] if match else stock.get('exchange')
    if exchange:
        result['exchange'] = exchange
    else:
        result.pop('exchange', None)
    return result


def normalize_sector_map(snapshot: dict) -> dict:
    return {**snapshot, 'sectors': [{**sector, 'stocks': [normalize_stock(stock) for stock in sector['stocks']]}
                                   for sector in snapshot['sectors']]}


def yahoo_symbol(symbol: str) -> str:
    if is_market_index(symbol):
        return f'^{public_symbol(symbol)}'
    if not KOREAN_CODE_PATTERN.fullmatch(symbol):
        return symbol
    cached = cached_korea_provider_symbol(symbol)
    if cached:
        return cached
    listings = korea_symbols(int(monotonic() // DIRECTORY_CACHE_SECONDS))
    for suffix in YAHOO_EXCHANGES:
        candidate = f'{symbol}.{suffix}'
        if candidate in listings:
            return candidate
    raise ValueError('Unknown Korean stock exchange')


def memo_symbol_aliases(symbol: str) -> list[str]:
    code = public_symbol(symbol)
    if is_market_index(code):
        return [code, f'^{code}']
    return [code, f'{code}.KS', f'{code}.KQ'] if KOREAN_CODE_PATTERN.fullmatch(code) else [code]
