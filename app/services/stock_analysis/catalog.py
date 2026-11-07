import csv
import re
from functools import lru_cache
from time import monotonic
from typing import Literal

import httpx
from services.stock_analysis.korea_yahoo import korea_display_names, korea_symbols

Market = Literal["KR", "US"]
NASDAQ_DIRECTORY = "https://www.nasdaqtrader.com/dynamic/SymDir/"


def get_symbols(market: Market, language: str = "en") -> dict[str, str]:
    if market == "KR":
        return dict(sorted(korea_display_names(language).items()))
    return _load_symbols(market, int(monotonic() // 3600))


@lru_cache(maxsize=4)
def _load_symbols(market: Market, cache_hour: int) -> dict[str, str]:
    if market == "KR":
        return dict(sorted(korea_symbols(cache_hour).items()))

    symbols = {}
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for filename, ticker_column in (("nasdaqlisted.txt", "Symbol"), ("otherlisted.txt", "ACT Symbol")):
            response = client.get(NASDAQ_DIRECTORY + filename)
            response.raise_for_status()
            rows = {}
            for row in csv.DictReader(response.text.splitlines(), delimiter="|"):
                ticker = row.get(ticker_column, "")
                if row.get("Test Issue") == "N" and row.get("ETF") == "N" and re.fullmatch(r"[A-Z]+(?:[.-][A-Z])?", ticker):
                    rows[ticker.replace(".", "-")] = row["Security Name"]
            if not rows:
                raise ValueError("Empty US directory")
            symbols.update(rows)
    return dict(sorted(symbols.items()))
