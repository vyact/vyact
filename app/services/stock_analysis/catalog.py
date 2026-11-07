import csv
import re
from functools import lru_cache
from time import monotonic
from typing import Literal

import httpx
from bs4 import BeautifulSoup

Market = Literal["KR", "US"]
KIND_LIST = "https://kind.krx.co.kr/corpgeneral/corpList.do"
NASDAQ_DIRECTORY = "https://www.nasdaqtrader.com/dynamic/SymDir/"


def get_symbols(market: Market) -> dict[str, str]:
    return _load_symbols(market, int(monotonic() // 3600))


def get_korea_listings() -> dict[str, tuple[str, str]]:
    return _load_korea_listings(int(monotonic() // 3600))


@lru_cache(maxsize=2)
def _load_korea_listings(cache_hour: int) -> dict[str, tuple[str, str]]:
    listings = {}
    with httpx.Client(timeout=20, follow_redirects=True) as client:
        for market_type, suffix in (("stockMkt", "KS"), ("kosdaqMkt", "KQ")):
            response = client.get(KIND_LIST, params={"method": "download", "marketType": market_type})
            response.raise_for_status()
            table = BeautifulSoup(response.content, "lxml", from_encoding=response.charset_encoding or "cp949")
            columns = [cell.get_text(strip=True) for cell in table.select("tr th")]
            code_index, name_index, industry_index = (columns.index(label) for label in ("종목코드", "회사명", "업종"))
            rows = {}
            for row in table.select("tr"):
                cells = row.find_all("td")
                if len(cells) <= max(code_index, name_index, industry_index):
                    continue
                code = cells[code_index].get_text(strip=True)
                if re.fullmatch(r"[0-9A-Z]{6}", code):
                    rows[f"{code}.{suffix}"] = (cells[name_index].get_text(strip=True), cells[industry_index].get_text(strip=True))
            if not rows:
                raise ValueError("Empty KRX directory")
            listings.update(rows)
    return listings


@lru_cache(maxsize=4)
def _load_symbols(market: Market, cache_hour: int) -> dict[str, str]:
    if market == "KR":
        return dict(sorted((symbol, entry[0]) for symbol, entry in _load_korea_listings(cache_hour).items()))

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
