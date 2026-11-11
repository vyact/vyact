import math
from datetime import datetime, timedelta, timezone
from concurrent.futures import ThreadPoolExecutor
from functools import lru_cache
from time import time

import httpx
from yfinance.data import YfData

from services.stock_analysis.symbols import yahoo_symbol, symbol_market
from services.stock_analysis.catalog import Market
from services.stock_analysis.market_group_cache import get_us_market_groups, freeze_us_layout_weights
from services.stock_analysis.market_sessions import us_premarket_window
from services.stock_analysis.regional_yahoo import get_korea_sector_members, korea_symbols, korea_display_names, japan_display_names, get_japan_sector_members

YAHOO_QUOTE_URL = "https://query1.finance.yahoo.com/v7/finance/quote"
QUOTE_BATCH_SIZE = 100
CACHE_SECONDS = 10
SECTOR_STOCK_LIMIT = 15
CHART_WORKERS = 8
YAHOO_CHART_URL = "https://query1.finance.yahoo.com/v8/finance/chart/"


def _sectors(groups: dict[str, list[dict]], *, limit: int | None = SECTOR_STOCK_LIMIT) -> list[dict]:
    sectors = []
    for name, stocks in groups.items():
        stocks = sorted(stocks, key=lambda stock: stock["weight"], reverse=True)[:limit]
        quoted = [stock for stock in stocks if stock["change"] is not None]
        total = sum(stock["weight"] for stock in quoted)
        sectors.append({
            "name": name, "weight": sum(stock["weight"] for stock in stocks),
            "change": sum(stock["weight"] * stock["change"] for stock in quoted) / total if total else None,
            "stocks": stocks,
        })
    return sectors


def _regional_map(market: Market, language: str = "en") -> dict:
    members = get_japan_sector_members() if market == "JP" else get_korea_sector_members()
    names = (japan_display_names(language) if market == "JP" else
             korea_display_names(language) if language == "ko" else korea_symbols(int(time() // 3600)))
    quotes = _us_quotes(list(dict.fromkeys(symbol for symbols in members.values() for symbol in symbols)))
    date = max((quote[0] for quote in quotes.values()), default=None)
    if date is None:
        raise ValueError(f"Yahoo returned no dated {market} quotes")
    groups = {}
    for sector, symbols in members.items():
        stocks = []
        for symbol in symbols:
            quote = quotes.get(symbol)
            if quote and quote[0] == date:
                _, price, change, market_cap = quote
                stocks.append({"symbol": symbol, "name": names.get(symbol, symbol),
                               "weight": market_cap, "price": price, "change": change})
        if stocks:
            groups[sector] = stocks
    return {"date": date, "quoteDate": date, "sectors": _sectors(groups)}


def _us_map(client: httpx.Client) -> dict:
    membership = get_us_market_groups(client)
    date = membership['date']
    groups = {name: [{**stock, 'weight': 0, 'price': None, 'change': None} for stock in entries]
              for name, entries in membership['groups'].items()}

    stocks = [stock for group in groups.values() for stock in group]
    symbols = list(dict.fromkeys(stock["symbol"] for stock in stocks))
    quote_details = {}
    quotes = _us_quotes(symbols, details=quote_details)
    weights = freeze_us_layout_weights(membership, {symbol: quote[3] for symbol, quote in quotes.items()})
    # Freeze company market caps daily; prices and percentage changes remain live.
    for sector_stocks in groups.values():
        for stock in sector_stocks:
            stock["weight"] = weights.get(stock["symbol"], 0)
        sector_stocks[:] = sorted(
            (stock for stock in sector_stocks if stock["weight"] > 0),
            key=lambda stock: stock["weight"], reverse=True,
        )
    groups = {name: entries for name, entries in groups.items() if entries}
    stocks = [stock for group in groups.values() for stock in group]
    # Verify the latest session independently; use charts only for stale quotes.
    _, benchmark = _us_daily_quote("^GSPC")
    quote_date = max([quote[0] for quote in quotes.values()] + ([benchmark[0]] if benchmark else []), default=None)
    daily_quotes = {stock["symbol"]: quotes[stock["symbol"]][:3] for stock in stocks if stock["symbol"] in quotes}
    stale_symbols = [symbol for symbol, quote in daily_quotes.items() if quote[0] != quote_date]
    if stale_symbols:
        with ThreadPoolExecutor(max_workers=CHART_WORKERS) as executor:
            daily_quotes.update(executor.map(_us_daily_quote, stale_symbols))
    if quote_date is None:
        raise ValueError("Yahoo returned no dated quotes for IVV holdings")
    for stock in stocks:
        quote = daily_quotes.get(stock["symbol"])
        if quote and quote[0] == quote_date:
            _, stock["price"], stock["change"] = quote
    now = time()
    window = us_premarket_window(now)
    if window:
        for stock in stocks:
            _apply_premarket_quote(stock, quote_details.get(stock['symbol'], {}), window, now)
    quote_time = max((stock.get('quoteTime', '') for stock in stocks), default='') or None
    sectors = _sectors(groups, limit=None)
    for sector in sectors:
        sector['stockCount'] = len(membership['groups'][sector['name']])
    return {"date": date, "quoteDate": quote_date, "sectors": sectors,
            'session': 'premarket' if window else 'regular', 'quoteTime': quote_time}


def _premarket_quote(quote: dict, window: tuple[float, float], now: float, regular_price: float | None) -> dict | None:
    stamp, price = quote.get('preMarketTime'), quote.get('preMarketPrice')
    if not all(isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)
               for value in (stamp, price, regular_price)):
        return None
    if not (window[0] <= stamp < window[1] and stamp <= now + 60) or price <= 0 or regular_price <= 0:
        return None
    # The denominator must be the latest completed regular session, never an older close.
    regular_stamp = quote.get('regularMarketTime')
    if not isinstance(regular_stamp, (int, float)) or not math.isfinite(regular_stamp) or regular_stamp >= window[0]:
        return None
    if quote.get('regularMarketPrice') != regular_price:
        return None
    return {'price': price, 'change': (price / regular_price - 1) * 100,
            'quoteTime': datetime.fromtimestamp(stamp, timezone.utc).isoformat()}


def _apply_premarket_quote(stock: dict, details: dict, window: tuple[float, float], now: float) -> None:
    stock['regularPrice'], stock['regularChange'] = stock['price'], stock['change']
    stock['price'], stock['change'] = None, None
    premarket = _premarket_quote(details, window, now, stock['regularPrice'])
    if premarket:
        stock.update(premarket)


def _us_quotes(symbols: list[str], *, details: dict | None = None) -> dict[str, tuple[str, float, float, float]]:
    client = YfData()
    quotes = {}
    for start in range(0, len(symbols), QUOTE_BATCH_SIZE):
        result = client.get_raw_json(YAHOO_QUOTE_URL, params={
            "symbols": ",".join(symbols[start:start + QUOTE_BATCH_SIZE]), "formatted": "false", "_": int(time()),
        }, timeout=12)
        for quote in result["quoteResponse"]["result"]:
            if details is not None:
                details[quote['symbol']] = quote
            timestamp = quote.get("regularMarketTime")
            price = quote.get("regularMarketPrice")
            change = quote.get("regularMarketChangePercent")
            if not timestamp or not isinstance(price, (int, float)) or not isinstance(change, (int, float)):
                continue
            if not math.isfinite(price) or price <= 0 or not math.isfinite(change):
                continue
            exchange_zone = timezone(timedelta(milliseconds=quote.get("gmtOffSetMilliseconds") or 0))
            day = datetime.fromtimestamp(timestamp, tz=exchange_zone).date().isoformat()
            market_cap = quote.get("marketCap")
            if isinstance(market_cap, (int, float)) and math.isfinite(market_cap) and market_cap > 0:
                quotes[quote["symbol"]] = (day, price, change, market_cap)
    return quotes


def _us_daily_quote(symbol: str) -> tuple[str, tuple[str, float, float] | None]:
    result = YfData().get_raw_json(f"{YAHOO_CHART_URL}{symbol}", params={
        "range": "5d", "interval": "1d", "_": int(time()),
    }, timeout=12)["chart"]["result"][0]
    closes = result["indicators"]["quote"][0]["close"]
    bars = [(stamp, close) for stamp, close in zip(result.get("timestamp", []), closes)
            if isinstance(close, (int, float)) and math.isfinite(close) and close > 0]
    if len(bars) < 2:
        return symbol, None
    timestamp, price = bars[-1]
    exchange_zone = timezone(timedelta(seconds=result["meta"].get("gmtoffset", 0)))
    day = datetime.fromtimestamp(timestamp, tz=exchange_zone).date().isoformat()
    return symbol, (day, price, (price / bars[-2][1] - 1) * 100)


@lru_cache(maxsize=4)
def _load_map(market: Market, cache_window: int, language: str = "en") -> dict:
    with httpx.Client(timeout=15, follow_redirects=True) as client:
        snapshot = _regional_map(market, language) if market in ("KR", "JP") else _us_map(client)
    if not snapshot["sectors"]:
        raise ValueError("Empty sector map")
    return snapshot


def get_sector_map(market: Market, language: str = "en") -> dict:
    return _load_map(market, int(time() // CACHE_SECONDS), language.lower().split("-")[0] if language.lower().split("-")[0] in ("ko", "ja") else "en")


@lru_cache(maxsize=128)
def _load_stock_quotes(symbols: tuple[str, ...], cache_window: int) -> list[dict]:
    providers = {}
    for symbol in symbols:
        try:
            providers[symbol] = yahoo_symbol(symbol)
        except ValueError:
            continue
    details = {}
    quotes = _us_quotes(list(providers.values()), details=details) if providers else {}
    now = time()
    window = us_premarket_window(now)
    result = []
    for symbol, provider in providers.items():
        quote = quotes.get(provider)
        if quote is None:
            continue
        stock = {"symbol": symbol, "date": quote[0], "price": quote[1], "change": quote[2], "marketCap": quote[3]}
        if window and symbol_market(symbol) == 'US':
            stock['session'] = 'premarket'
            _apply_premarket_quote(stock, details.get(provider, {}), window, now)
        result.append(stock)
    return result


def get_stock_quotes(symbols: list[str]) -> list[dict]:
    return _load_stock_quotes(tuple(sorted(set(symbols))), int(time() // CACHE_SECONDS))
