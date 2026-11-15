"""Market-independent quotes with per-instrument session-aware caching."""
from concurrent.futures import ThreadPoolExecutor
from threading import Lock
from time import time

from services.stock_analysis.market_indices import _safe_fetch_index
from services.stock_analysis.market_sessions import active_session, next_regular_open

GLOBAL_INDICATOR_CALENDARS = {
    '^VIX': 'VIX',
    'CL=F': 'CMEGlobex_CL',
    'GC=F': 'CMEGlobex_GC',
    'DX-Y.NYB': 'ICEUS',
    '^TNX': 'Bond_Markets_US',
}
GLOBAL_INDICATOR_SYMBOLS = tuple(GLOBAL_INDICATOR_CALENDARS)
GLOBAL_INDICATOR_CACHE_SECONDS = 60
CLOSING_QUOTE_GRACE_SECONDS = 20 * 60
FAILED_QUOTE_RETRY_SECONDS = 5 * 60
_cache = {}
_locks = {symbol: Lock() for symbol in GLOBAL_INDICATOR_SYMBOLS}


def _session_refresh(symbol, now):
    calendar = GLOBAL_INDICATOR_CALENDARS[symbol]
    # Include a short post-close window for delayed/final quotes.
    if active_session(calendar, now) or active_session(calendar, now - CLOSING_QUOTE_GRACE_SECONDS):
        return now + GLOBAL_INDICATOR_CACHE_SECONDS
    return next_regular_open(now, calendar) or now + 24 * 60 * 60


def _quote(symbol):
    with _locks[symbol]:
        now = time()
        cached = _cache.get(symbol)
        if cached and now < cached['nextRefreshAt']:
            return dict(cached)
        try:
            refresh_at = _session_refresh(symbol, now)
        except Exception:
            # Calendar failures must not suppress updates indefinitely.
            refresh_at = now + FAILED_QUOTE_RETRY_SECONDS
        quote = _safe_fetch_index(symbol)
        if quote['price'] is None:
            refresh_at = min(refresh_at, now + FAILED_QUOTE_RETRY_SECONDS)
            if cached:
                quote = {**cached, 'stale': True}
        quote = {**quote, 'nextRefreshAt': refresh_at}
        _cache[symbol] = quote
        return dict(quote)


def get_global_indicators() -> list[dict]:
    with ThreadPoolExecutor(max_workers=len(GLOBAL_INDICATOR_SYMBOLS)) as executor:
        return list(executor.map(_quote, GLOBAL_INDICATOR_SYMBOLS))
