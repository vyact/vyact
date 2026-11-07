import math
from functools import lru_cache
from time import time

import yfinance as yf

from services.stock_analysis.market_indices import INDEX_SYMBOLS

MAX_OVERNIGHT_PRICE_RATIO = 4
PRICE_HISTORY_PERIOD = "10y"
INDEX_HISTORY_PERIOD = "max"


def fetch_prices(symbol: str, *, start: str | None = None) -> list[dict]:
    history_range = {"start": start} if start else {"period": INDEX_HISTORY_PERIOD if symbol in INDEX_SYMBOLS else PRICE_HISTORY_PERIOD}
    history = yf.Ticker(symbol).history(
        **history_range, interval="1d", auto_adjust=False, actions=False,
        raise_errors=True, timeout=15,
    )
    rows = []
    for timestamp, bar in history.sort_index().iterrows():
        prices = {key.lower(): float(bar[key]) for key in ("Open", "High", "Low", "Close")}
        if not all(math.isfinite(price) and price > 0 for price in prices.values()):
            continue
        volume = float(bar["Volume"])
        rows.append({
            "day": timestamp.date().isoformat(),
            **prices,
            "volume": int(volume) if math.isfinite(volume) and volume >= 0 else None,
        })
    for previous, current in zip(rows, rows[1:]):
        ratio = current["open"] / previous["close"]
        if not 1 / MAX_OVERNIGHT_PRICE_RATIO < ratio < MAX_OVERNIGHT_PRICE_RATIO:
            raise ValueError(f"Unverified price discontinuity between {previous['day']} and {current['day']}")
    return rows


SPARKLINE_TRADING_DAYS = 20
SPARKLINE_CACHE_SECONDS = 3600


@lru_cache(maxsize=1024)
def _fetch_sparkline(symbol: str, cache_window: int) -> tuple[float, ...]:
    history = yf.Ticker(symbol).history(
        period="3mo", interval="1d", auto_adjust=True, actions=False,
        raise_errors=True, timeout=15,
    )
    return tuple(float(close) for close in history["Close"].dropna().tail(SPARKLINE_TRADING_DAYS)
                 if math.isfinite(float(close)) and float(close) > 0)


def fetch_sparkline(symbol: str) -> list[float]:
    return list(_fetch_sparkline(symbol, int(time() // SPARKLINE_CACHE_SECONDS)))
