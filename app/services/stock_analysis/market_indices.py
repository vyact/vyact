import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache
from time import time
from zoneinfo import ZoneInfo

from yfinance.data import YfData

from services.stock_analysis.market_sessions import CASH_CALENDAR, FUTURES_CALENDAR, active_session, next_regular_open, JAPAN_CASH_CALENDAR, is_session_break

MARKET_INDEX_SYMBOLS = {"US": ("^GSPC", "^IXIC", "^RUT"), "KR": ("^KS11", "^KQ11"), "JP": ("^N225",)}
US_INDEX_FUTURES = {"^GSPC": "ES=F", "^IXIC": "NQ=F", "^RUT": "RTY=F"}
MARKET_INDEX_FUTURES = {"US": US_INDEX_FUTURES, "JP": {"^N225": "NIY=F"}}
INDEX_FUTURE_SYMBOLS = frozenset(symbol for mapping in MARKET_INDEX_FUTURES.values() for symbol in mapping.values())
CASH_CALENDARS = {"US": CASH_CALENDAR, "JP": JAPAN_CASH_CALENDAR}
INDEX_SYMBOLS = tuple(symbol for symbols in MARKET_INDEX_SYMBOLS.values() for symbol in symbols)

def index_timezone(symbol: str) -> ZoneInfo:
    if symbol in MARKET_INDEX_SYMBOLS["JP"]:
        return ZoneInfo("Asia/Tokyo")
    return ZoneInfo("Asia/Seoul" if symbol in MARKET_INDEX_SYMBOLS["KR"] else "America/New_York")
INDEX_CACHE_SECONDS = 10
INDEX_CHART_TRADING_DAYS = 20
INDEX_FETCH_ATTEMPTS = 2
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
MAX_FUTURES_QUOTE_AGE_SECONDS = 30 * 60
logger = logging.getLogger(__name__)


def _positive(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _fetch_index(symbol: str) -> dict:
    result = YfData().get_raw_json(f"{CHART_URL}{symbol}", params={
        "range": "3mo", "interval": "1d", "includePrePost": "false",
    }, timeout=12)["chart"]["result"][0]
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    # chartPreviousClose is the close before the entire requested range.
    previous = meta.get("previousClose")
    timestamp = meta.get("regularMarketTime")
    if not _positive(price) or not timestamp:
        raise ValueError(f"Missing index quote: {symbol}")
    day = datetime.fromtimestamp(timestamp, index_timezone(symbol)).date().isoformat()
    quotes = result.get("indicators", {}).get("quote") or [{}]
    bars = quotes[0].get("close") or []
    daily_bars = [(datetime.fromtimestamp(stamp, index_timezone(symbol)).date().isoformat(), close)
                  for stamp, close in zip(result.get("timestamp", []), bars) if _positive(close)]
    if not _positive(previous):
        previous = next((close for bar_day, close in reversed(daily_bars) if bar_day < day), None)
    change = price - previous if _positive(previous) else None
    closes = [close for bar_day, close in daily_bars if bar_day <= day][-INDEX_CHART_TRADING_DAYS:]
    return {"symbol": symbol, "price": price, "change": change,
            "changePercent": (price / previous - 1) * 100 if change is not None else None,
            "date": day, "closes": closes, "quoteTime": timestamp}


def _safe_fetch_index(symbol: str) -> dict:
    for attempt in range(INDEX_FETCH_ATTEMPTS):
        try:
            return _fetch_index(symbol)
        except Exception as exc:
            logger.warning("Market index unavailable for %s (attempt %s): %s", symbol, attempt + 1, exc)
    return {"symbol": symbol, "price": None, "change": None, "changePercent": None,
            "date": None, "closes": []}


@lru_cache(maxsize=3)
def _load_indices(cache_window: int, market: str) -> list[dict]:
    symbols = MARKET_INDEX_SYMBOLS[market]
    with ThreadPoolExecutor(max_workers=len(symbols)) as executor:
        indices = list(executor.map(_safe_fetch_index, symbols))
        now = time()
        mapping = MARKET_INDEX_FUTURES.get(market)
        calendar = CASH_CALENDARS.get(market)
        if mapping and calendar and not active_session(calendar, now) and not is_session_break(calendar, now):
            session = active_session(FUTURES_CALENDAR, now)
            if session:
                futures = list(executor.map(_safe_fetch_index, mapping.values()))
                # Never replace the cash close with a previous futures session,
                # a failed request, or a stale holiday quote. Allow delayed data.
                if all(quote["price"] is not None
                       and session[0] <= quote.get("quoteTime", 0) <= now
                       and now - quote["quoteTime"] <= MAX_FUTURES_QUOTE_AGE_SECONDS
                       for quote in futures):
                    opening = next_regular_open(now, calendar)
                    return [{**quote, "indexSymbol": index.removeprefix("^"), "nextRegularOpen": opening}
                            for index, quote in zip(symbols, futures)]
        return indices


def get_market_indices(market: str = "US") -> list[dict]:
    return _load_indices(int(time() // INDEX_CACHE_SECONDS), market)
