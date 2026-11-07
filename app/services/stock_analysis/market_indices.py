import logging
import math
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from functools import lru_cache
from time import monotonic
from zoneinfo import ZoneInfo

from yfinance.data import YfData

INDEX_SYMBOLS = ("^GSPC", "^IXIC", "^RUT")
INDEX_CACHE_SECONDS = 10
CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"
NEW_YORK = ZoneInfo("America/New_York")
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
    day = datetime.fromtimestamp(timestamp, NEW_YORK).date().isoformat()
    bars = result["indicators"]["quote"][0]["close"]
    closes = [close for stamp, close in zip(result.get("timestamp", []), bars)
              if _positive(close) and datetime.fromtimestamp(stamp, NEW_YORK).date().isoformat() == day]
    return {"symbol": symbol, "price": price, "change": price - previous,
            "changePercent": (price / previous - 1) * 100, "date": day, "closes": closes}


def _safe_fetch_index(symbol: str) -> dict:
    try:
        return _fetch_index(symbol)
    except Exception as exc:
        logger.warning("Market index unavailable for %s: %s", symbol, exc)
        return {"symbol": symbol, "price": None, "change": None, "changePercent": None,
                "date": None, "closes": []}


@lru_cache(maxsize=2)
def _load_indices(cache_window: int) -> list[dict]:
    with ThreadPoolExecutor(max_workers=len(INDEX_SYMBOLS)) as executor:
        return list(executor.map(_safe_fetch_index, INDEX_SYMBOLS))


def get_market_indices() -> list[dict]:
    return _load_indices(int(monotonic() // INDEX_CACHE_SECONDS))
