import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache
from time import monotonic, time
from zoneinfo import ZoneInfo

from yfinance.data import YfData

from services.stock_analysis.market_sessions import CASH_CALENDAR, FUTURES_CALENDAR, active_session, next_regular_open

MARKET_INDEX_SYMBOLS = {"US": ("^GSPC", "^IXIC", "^RUT"), "KR": ("^KS11", "^KQ11"), "JP": ("^N225",)}
US_INDEX_FUTURES = {"^GSPC": "ES=F", "^IXIC": "NQ=F", "^RUT": "RTY=F"}
INDEX_SYMBOLS = tuple(symbol for symbols in MARKET_INDEX_SYMBOLS.values() for symbol in symbols)

def index_timezone(symbol: str) -> ZoneInfo:
    if symbol in MARKET_INDEX_SYMBOLS["JP"]:
        return ZoneInfo("Asia/Tokyo")
    return ZoneInfo("Asia/Seoul" if symbol in MARKET_INDEX_SYMBOLS["KR"] else "America/New_York")
INDEX_CACHE_SECONDS = 10
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
MAX_FUTURES_QUOTE_AGE_SECONDS = 30 * 60
logger = logging.getLogger(__name__)


def _positive(value) -> bool:
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _fetch_index(symbol: str) -> dict:
    result = YfData().get_raw_json(f"{CHART_URL}{symbol}", params={
        "range": "1d", "interval": "5m", "includePrePost": "false",
    }, timeout=12)["chart"]["result"][0]
    meta = result["meta"]
    price = meta.get("regularMarketPrice")
    previous = meta.get("chartPreviousClose") or meta.get("previousClose")
    timestamp = meta.get("regularMarketTime")
    if not _positive(price) or not _positive(previous) or not timestamp:
        raise ValueError(f"Missing index quote: {symbol}")
    day = datetime.fromtimestamp(timestamp, index_timezone(symbol)).date().isoformat()
    bars = result["indicators"]["quote"][0]["close"]
    closes = [close for stamp, close in zip(result.get("timestamp", []), bars)
              if _positive(close) and (symbol in US_INDEX_FUTURES.values()
                  or datetime.fromtimestamp(stamp, index_timezone(symbol)).date().isoformat() == day)]
    return {"symbol": symbol, "price": price, "change": price - previous,
            "changePercent": (price / previous - 1) * 100, "date": day, "closes": closes, "quoteTime": timestamp}


def _safe_fetch_index(symbol: str) -> dict:
    try:
        return _fetch_index(symbol)
    except Exception as exc:
        logger.warning("Market index unavailable for %s: %s", symbol, exc)
        return {"symbol": symbol, "price": None, "change": None, "changePercent": None,
                "date": None, "closes": []}


@lru_cache(maxsize=3)
def _load_indices(cache_window: int, market: str) -> list[dict]:
    symbols = MARKET_INDEX_SYMBOLS[market]
    with ThreadPoolExecutor(max_workers=len(symbols)) as executor:
        indices = list(executor.map(_safe_fetch_index, symbols))
        now = time()
        if market == "US" and not active_session(CASH_CALENDAR, now):
            session = active_session(FUTURES_CALENDAR, now)
            if session:
                futures = list(executor.map(_safe_fetch_index, US_INDEX_FUTURES.values()))
                # Never replace the cash close with a previous futures session,
                # a failed request, or a stale holiday quote. Allow delayed data.
                if all(quote["price"] is not None
                       and session[0] <= quote.get("quoteTime", 0) <= now
                       and now - quote["quoteTime"] <= MAX_FUTURES_QUOTE_AGE_SECONDS
                       for quote in futures):
                    opening = next_regular_open(now)
                    return [{**quote, "indexSymbol": index.removeprefix("^"), "nextRegularOpen": opening}
                            for index, quote in zip(symbols, futures)]
        return indices


def get_market_indices(market: str = "US") -> list[dict]:
    return _load_indices(int(monotonic() // INDEX_CACHE_SECONDS), market)
