import asyncio
from datetime import date
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Response
from elasticsearch import NotFoundError
from pydantic import BaseModel, StringConstraints
from yfinance.exceptions import YFPricesMissingError, YFRateLimitError, YFTzMissingError

from logger import get_logger
from services.db import STOCK_CHART_MEMOS_INDEX, ensure_stock_chart_memos_index, get_es
from services.stock_analysis.catalog import Market, get_symbols
from services.stock_analysis.market_indices import INDEX_SYMBOLS, get_market_indices
from services.stock_analysis.index_price_store import get_index_prices
from services.stock_analysis.prices import fetch_prices, fetch_sparkline
from services.stock_analysis.sector_map import get_sector_map

router = APIRouter(prefix="/stock-analysis")
logger = get_logger(__name__)
Symbol = Annotated[str, Path(pattern=r"^(?:[A-Z0-9][A-Z0-9.-]{0,15}|\^(?:GSPC|IXIC|RUT|KS11|KQ11))$")]


@router.get("/symbols/{market}")
def list_symbols(market: Market):
    try:
        return [{"symbol": symbol, "name": name} for symbol, name in get_symbols(market).items()]
    except Exception as exc:
        logger.warning("Stock directory unavailable for %s: %s", market, exc)
        raise HTTPException(502, "directory_unavailable") from exc


@router.get("/market-indices")
def market_indices(response: Response, market: Market = "US"):
    response.headers["Cache-Control"] = "no-store"
    return get_market_indices(market)


@router.get("/sector-map/{market}")
def sector_map(market: Market):
    try:
        return get_sector_map(market)
    except Exception as exc:
        logger.warning("Sector map unavailable for %s: %s", market, exc)
        raise HTTPException(502, "sector_map_unavailable") from exc


@router.get("/sparkline/{symbol}")
def sparkline(symbol: Symbol):
    try:
        return fetch_sparkline(symbol)
    except YFRateLimitError as exc:
        raise HTTPException(429, "price_rate_limited") from exc
    except Exception as exc:
        logger.warning("Sparkline unavailable for %s: %s", symbol, exc)
        raise HTTPException(502, "price_unavailable") from exc


@router.get("/prices/{symbol}")
async def daily_prices(symbol: Symbol, response: Response):
    response.headers["Cache-Control"] = "no-store"
    try:
        return await get_index_prices(symbol) if symbol in INDEX_SYMBOLS else await asyncio.to_thread(fetch_prices, symbol)
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
                index=STOCK_CHART_MEMOS_INDEX, query={"term": {"symbol": symbol}},
                sort=[{"day": "asc"}], size=500, search_after=after,
            )
        except NotFoundError:
            return []
        hits = page["hits"]["hits"]
        memos.extend(hit["_source"] for hit in hits)
        if len(hits) < 500:
            return memos
        after = hits[-1]["sort"]


@router.put("/memos/{symbol}/{day}")
async def save_stock_memo(symbol: Symbol, day: date, draft: StockMemoDraft):
    es = get_es()
    await ensure_stock_chart_memos_index(es)
    memo = {"symbol": symbol, "day": day.isoformat(), **draft.model_dump()}
    await es.index(index=STOCK_CHART_MEMOS_INDEX, id=f"{symbol}:{day.isoformat()}", document=memo, refresh="wait_for")
    return memo
