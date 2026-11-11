import asyncio
import logging
from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from elasticsearch import NotFoundError

from services.db import MARKET_INDEX_PRICES_INDEX, ensure_market_index_prices_index, get_es
from services.stock_analysis.market_indices import MARKET_INDEX_SYMBOLS, index_timezone
from services.stock_analysis.prices import fetch_prices
from services.stock_analysis.symbols import is_market_index, yahoo_symbol

PAGE_SIZE = 2000
BULK_SIZE = 1000
CORRECTION_TRADING_DAYS = 5
SYNC_INTERVAL_SECONDS = 60
NEW_YORK = ZoneInfo("America/New_York")
logger = logging.getLogger(__name__)
_sync_tasks: dict[str, asyncio.Task] = {}


async def _read_rows(es, symbol: str) -> list[dict]:
    rows = []
    after = None
    while True:
        result = await es.search(
            index=MARKET_INDEX_PRICES_INDEX,
            query={"bool": {"filter": [{"term": {"symbol": symbol}}, {"term": {"kind": "bar"}}]}},
            sort=[{"day": "asc"}], size=PAGE_SIZE, search_after=after,
        )
        hits = result["hits"]["hits"]
        rows.extend({key: hit["_source"][key] for key in ("day", "open", "high", "low", "close", "volume")} for hit in hits)
        if len(hits) < PAGE_SIZE:
            return rows
        after = hits[-1]["sort"]


async def _read_state(es, symbol: str) -> dict:
    try:
        result = await es.get(index=MARKET_INDEX_PRICES_INDEX, id=f"{symbol}:state")
        return result["_source"]
    except NotFoundError:
        return {}


def _needs_sync(state: dict, now: datetime, symbol: str = "^GSPC") -> bool:
    if not state.get("initialized") or not state.get("synced_at"):
        return True
    synced = datetime.fromisoformat(state["synced_at"])
    local = now.astimezone(index_timezone(symbol))
    if local.weekday() >= 5:
        close_hour, close_minute = next((close for market, close in {"KR": (15, 30), "JP": (15, 30), "TW": (13, 30), "CN": (15, 0)}.items()
                                       if symbol in MARKET_INDEX_SYMBOLS[market]), (16, 0))
        friday_close = (local - timedelta(days=local.weekday() - 4)).replace(hour=close_hour, minute=close_minute, second=0, microsecond=0)
        if synced >= friday_close:
            return False
    return (now - synced).total_seconds() >= SYNC_INTERVAL_SECONDS


async def _sync(symbol: str, es, rows: list[dict], state: dict) -> None:
    try:
        # Retry the entire bootstrap after any partial/failed initial import.
        start = rows[-CORRECTION_TRADING_DAYS:][0]["day"] if rows and state.get("initialized") else None
        fresh = await asyncio.to_thread(fetch_prices, symbol, start=start)
        if not fresh:
            raise ValueError(f"No index history returned: {symbol}")
        for offset in range(0, len(fresh), BULK_SIZE):
            operations = []
            for row in fresh[offset:offset + BULK_SIZE]:
                operations.extend([
                    {"index": {"_index": MARKET_INDEX_PRICES_INDEX, "_id": f"{symbol}:{row['day']}"}},
                    {"symbol": symbol, "kind": "bar", **row},
                ])
            result = await es.bulk(operations=operations, refresh=False)
            if result.get("errors"):
                raise RuntimeError(f"Index history bulk write failed: {symbol}")
        await es.indices.refresh(index=MARKET_INDEX_PRICES_INDEX)
        await es.index(index=MARKET_INDEX_PRICES_INDEX, id=f"{symbol}:state", document={
            "symbol": symbol, "kind": "state", "initialized": True,
            "synced_at": datetime.now(timezone.utc).isoformat(),
        }, refresh="wait_for")
    except Exception:
        logger.exception("Index history synchronization failed for %s", symbol)
        raise


def _consume_result(task: asyncio.Task) -> None:
    if not task.cancelled():
        task.exception()


async def get_index_prices(symbol: str) -> list[dict]:
    if not is_market_index(symbol):
        raise ValueError("Only market indices may use the history store")
    symbol = yahoo_symbol(symbol)
    es = get_es()
    await ensure_market_index_prices_index(es)
    rows = await _read_rows(es, symbol)
    state = await _read_state(es, symbol)
    task = _sync_tasks.get(symbol)
    if (not rows or _needs_sync(state, datetime.now(timezone.utc), symbol)) and (task is None or task.done()):
        task = asyncio.create_task(_sync(symbol, es, rows, state))
        _sync_tasks[symbol] = task
        task.add_done_callback(_consume_result)
    if task is not None and (not task.done() or not rows):
        # Return refreshed bars on this request, rather than leaving the chart
        # on the previous trading day until another manual reload.
        # Request cancellation must not interrupt a shared synchronization.
        try:
            await asyncio.shield(task)
        except Exception:
            if rows:
                return rows
            raise
        return await _read_rows(es, symbol)
    return rows
