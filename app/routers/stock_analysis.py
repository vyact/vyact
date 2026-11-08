import asyncio
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response
from elasticsearch import NotFoundError
from pydantic import BaseModel, StringConstraints, Field
from yfinance.exceptions import YFPricesMissingError, YFRateLimitError, YFTzMissingError

from logger import get_logger
from services.db import STOCK_CHART_MEMOS_INDEX, ensure_stock_chart_memos_index, get_es
from services.stock_analysis.api_settings import (ApiValidationRequest, EndpointKind, MarketApiSettings, STOCK_SYMBOL_PATTERN, validate_api_settings, custom_data, load_api_settings, public_settings, save_api_settings, symbol_market)
from services.stock_analysis.catalog import Market, get_symbols
from services.stock_analysis.market_indices import get_market_indices
from services.stock_analysis.index_price_store import get_index_prices
from services.stock_analysis.korea_yahoo import korea_preferred_symbols
from services.stock_analysis.prices import fetch_prices, fetch_sparkline
from services.stock_analysis.sector_map import get_sector_map
from services.stock_analysis.symbols import is_market_index, memo_symbol_aliases, normalize_market_indices, normalize_stock, normalize_sector_map, public_symbol

router = APIRouter(prefix="/stock-analysis")
logger = get_logger(__name__)
Symbol = Annotated[str, Path(pattern=STOCK_SYMBOL_PATTERN)]


@router.get("/api-settings/{market}")
async def get_market_api_settings(market: Market):
    return public_settings(await load_api_settings(market))


@router.put("/api-settings/{market}")
async def put_market_api_settings(market: Market, settings: MarketApiSettings):
    return await save_api_settings(market, settings)


@router.post("/api-settings/{market}/validate/{kind}")
async def validate_market_api_settings(market: Market, kind: EndpointKind, draft: ApiValidationRequest, response: Response):
    response.headers['Cache-Control'] = 'no-store'
    return await validate_api_settings(market, kind, draft)


@router.get("/symbols/{market}")
async def list_symbols(market: Market, language: str = "en"):
    custom = await custom_data(market, 'symbols', language=language)
    if custom is not None:
        return custom
    try:
        names = await asyncio.to_thread(get_symbols, market, language)
        preferred = await asyncio.to_thread(korea_preferred_symbols, language) if market == "KR" else set()
        return [normalize_stock({"symbol": symbol, "name": name, "preferred": symbol in preferred}) for symbol, name in names.items()]
    except Exception as exc:
        logger.warning("Stock directory unavailable for %s: %s", market, exc)
        raise HTTPException(502, "directory_unavailable") from exc


@router.get("/market-indices")
async def market_indices(response: Response, market: Market = "US"):
    response.headers["Cache-Control"] = "no-store"
    custom = await custom_data(market, 'marketIndices')
    return custom if custom is not None else normalize_market_indices(await asyncio.to_thread(get_market_indices, market))


@router.get("/sector-map/{market}")
async def sector_map(market: Market, language: str = "en"):
    custom = await custom_data(market, 'sectorMap', language=language)
    if custom is not None:
        return custom
    try:
        return normalize_sector_map(await asyncio.to_thread(get_sector_map, market, language))
    except Exception as exc:
        logger.warning("Sector map unavailable for %s: %s", market, exc)
        raise HTTPException(502, "sector_map_unavailable") from exc


class SparklineBatchRequest(BaseModel):
    symbols: list[Annotated[str, StringConstraints(pattern=STOCK_SYMBOL_PATTERN)]] = Field(min_length=1, max_length=100)


@router.post("/sparklines")
async def sparklines(draft: SparklineBatchRequest):
    grouped = {}
    for symbol in dict.fromkeys(public_symbol(item) for item in draft.symbols):
        grouped.setdefault(symbol_market(symbol), []).append(symbol)
    result = {}
    semaphore = asyncio.Semaphore(4)

    async def yahoo_sparkline(symbol):
        async with semaphore:
            try:
                return symbol, await asyncio.to_thread(fetch_sparkline, symbol)
            except Exception as exc:
                logger.warning("Sparkline unavailable for %s: %s", symbol, exc)
                return symbol, []

    for market, symbols in grouped.items():
        custom = await custom_data(market, 'sparkline', symbols=symbols)
        if custom is not None:
            result.update(custom)
        else:
            result.update(await asyncio.gather(*(yahoo_sparkline(symbol) for symbol in symbols)))
    return result


@router.get("/sparkline/{symbol}")
async def sparkline(symbol: Symbol):
    custom = await custom_data(symbol_market(symbol), 'sparkline', symbol=symbol)
    if custom is not None:
        return custom
    try:
        return await asyncio.to_thread(fetch_sparkline, symbol)
    except YFRateLimitError as exc:
        raise HTTPException(429, "price_rate_limited") from exc
    except Exception as exc:
        logger.warning("Sparkline unavailable for %s: %s", symbol, exc)
        raise HTTPException(502, "price_unavailable") from exc


@router.get("/prices/{symbol}")
async def daily_prices(symbol: Symbol, response: Response):
    response.headers["Cache-Control"] = "no-store"
    custom = await custom_data(symbol_market(symbol), 'prices', symbol=symbol)
    if custom is not None:
        return custom
    try:
        return await get_index_prices(symbol) if is_market_index(symbol) else await asyncio.to_thread(fetch_prices, symbol)
    except YFRateLimitError as exc:
        raise HTTPException(429, "price_rate_limited") from exc
    except (YFPricesMissingError, YFTzMissingError):
        return []
    except Exception as exc:
        logger.warning("Daily prices unavailable for %s: %s", symbol, exc)
        raise HTTPException(502, "price_unavailable") from exc


class StockMemoDraft(BaseModel):
    title: Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]
    content: Annotated[str, StringConstraints(strip_whitespace=True, max_length=10000)]


@router.get("/memos/{symbol}")
async def list_stock_memos(symbol: Symbol, response: Response):
    response.headers["Cache-Control"] = "no-store"
    es = get_es()
    memos = []
    after = None
    while True:
        try:
            page = await es.search(
                index=STOCK_CHART_MEMOS_INDEX, query={"terms": {"symbol": memo_symbol_aliases(symbol)}},
                sort=[{"day": "asc"}, {"symbol": "asc"}], size=500, search_after=after,
            )
        except NotFoundError:
            return []
        hits = page["hits"]["hits"]
        memos.extend(hit["_source"] for hit in hits)
        if len(hits) < 500:
            by_day = {}
            for memo in memos:
                previous = by_day.get(memo['day'])
                if previous is None or memo['symbol'] == public_symbol(symbol):
                    by_day[memo['day']] = {**memo, 'symbol': public_symbol(symbol)}
            return list(by_day.values())
        after = hits[-1]["sort"]


@router.put("/memos/{symbol}/{day}")
async def save_stock_memo(symbol: Symbol, day: date, draft: StockMemoDraft):
    es = get_es()
    await ensure_stock_chart_memos_index(es)
    storage_symbol = public_symbol(symbol)
    for alias in memo_symbol_aliases(symbol):
        if await es.exists(index=STOCK_CHART_MEMOS_INDEX, id=f"{alias}:{day.isoformat()}"):
            storage_symbol = alias
            break
    memo = {"symbol": storage_symbol, "day": day.isoformat(), **draft.model_dump()}
    await es.index(index=STOCK_CHART_MEMOS_INDEX, id=f"{storage_symbol}:{day.isoformat()}", document=memo, refresh="wait_for")
    return {**memo, 'symbol': public_symbol(symbol)}


@router.delete("/memos/{symbol}/{day}")
async def delete_stock_memo(symbol: Symbol, day: date):
    es = get_es()
    for alias in memo_symbol_aliases(symbol):
        try:
            await es.delete(index=STOCK_CHART_MEMOS_INDEX, id=f"{alias}:{day.isoformat()}", refresh="wait_for")
        except NotFoundError:
            pass
    return {"deleted": True}
