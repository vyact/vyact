"""Single-backend persistent bulk collector; checkpoint before advancing the queue."""
import asyncio
import logging
from datetime import datetime, timedelta

from pydantic import BaseModel
from yfinance.exceptions import YFRateLimitError

from services.stock_analysis.api_settings import custom_data
from services.stock_analysis.catalog import get_symbols
from services.stock_analysis.financial_store import get_financials, read_document, write_document, utc_now, stop_refreshes
from services.stock_analysis.symbols import is_market_index, public_symbol, symbol_market

MARKETS = ('US', 'KR', 'JP', 'TW', 'HK', 'CN')
WEEK = timedelta(days=7)
POLL_SECONDS = 60
RATE_LIMIT_BACKOFF_SECONDS = 120
logger = logging.getLogger(__name__)
_jobs: dict[str, asyncio.Task] = {}
_market_locks = {market: asyncio.Lock() for market in MARKETS}
_scheduler = None


class FinancialCollectionSettings(BaseModel):
    autoUpdate: bool = False


async def collection_status(market):
    settings = await read_document(f'settings:{market}') or {'autoUpdate': False}
    job = await read_document(f'job:{market}') or {'status': 'idle', 'total': 0, 'processed': 0, 'failed': 0, 'empty': 0}
    return {'settings': settings, 'job': {key: value for key, value in job.items() if key not in ('symbols', 'failedSymbols')}}


async def save_settings(market, settings):
    await write_document(f'settings:{market}', settings.model_dump())
    return await collection_status(market)


async def _run(market, job):
    try:
        for symbol in job['symbols'][job['processed']:]:
            job['currentSymbol'] = symbol
            await write_document(f'job:{market}', job)
            try:
                results = []
                for frequency in ('yearly', 'quarterly'):
                    try:
                        results.append(await get_financials(symbol, frequency, wait=True, force=job.get('retryFailed', False)))
                    except YFRateLimitError:
                        # All provider users share a cooldown, including individual reads.
                        await asyncio.sleep(RATE_LIMIT_BACKOFF_SECONDS)
                        raise
                if any(result.get('refreshFailed') for result in results):
                    raise ValueError('Financial refresh is awaiting retry')
                if all(result.get('availability') == 'empty' for result in results):
                    job['empty'] += 1
            except Exception:
                job['failed'] += 1
                job.setdefault('failedSymbols', []).append(symbol)
            job['processed'] += 1
            await write_document(f'job:{market}', job)
        job.update(status='completed', completedAt=utc_now().isoformat(), currentSymbol=None)
        await write_document(f'job:{market}', job)
    except asyncio.CancelledError:
        # A running checkpoint is resumed on the next backend startup.
        raise
    except Exception:
        logger.exception('Financial collection interrupted for %s', market)
        # Leave the running checkpoint intact for the scheduler to retry.


async def start_collection(market, *, resume=False, failed_only=False):
    async with _market_locks[market]:
        active = _jobs.get(market)
        if active is not None and not active.done():
            return await collection_status(market)
        previous = await read_document(f'job:{market}') or {}
        if resume and previous.get('status') == 'running':
            job = previous
        else:
            if failed_only:
                symbols = previous.get('failedSymbols', [])
            else:
                custom = await custom_data(market, 'symbols')
                symbols = [item['symbol'] for item in custom] if custom is not None else list(await asyncio.to_thread(get_symbols, market))
            symbols = sorted({public_symbol(symbol) for symbol in symbols if not is_market_index(symbol) and symbol_market(symbol) == market})
            if not symbols:
                raise ValueError('No financial collection targets')
            job = {'status': 'running', 'symbols': symbols, 'total': len(symbols), 'processed': 0,
                   'failed': 0, 'empty': 0, 'failedSymbols': [], 'retryFailed': failed_only, 'startedAt': utc_now().isoformat(),
                   'lastFullStartedAt': previous.get('lastFullStartedAt') if failed_only else utc_now().isoformat()}
        await write_document(f'job:{market}', job)
        _jobs[market] = asyncio.create_task(_run(market, job))
        return await collection_status(market)


async def stop_collection(market):
    async with _market_locks[market]:
        task = _jobs.get(market)
        if task is not None and not task.done():
            task.cancel()
            await asyncio.gather(task, return_exceptions=True)
        job = await read_document(f'job:{market}')
        if job:
            job['status'] = 'paused'
            await write_document(f'job:{market}', job)
        return await collection_status(market)


async def resume_collection(market):
    async with _market_locks[market]:
        job = await read_document(f'job:{market}')
        if job and job.get('status') == 'paused':
            job['status'] = 'running'
            await write_document(f'job:{market}', job)
    return await start_collection(market, resume=True)


async def run_scheduled_collections():
    for market in MARKETS:
        try:
            status = await collection_status(market)
            job = status['job']
            if job['status'] == 'running':
                await start_collection(market, resume=True)
            elif status['settings'].get('autoUpdate') and job['status'] != 'paused':
                started = job.get('lastFullStartedAt')
                if not started or utc_now() - datetime.fromisoformat(started) >= WEEK:
                    await start_collection(market)
        except Exception:
            logger.warning('Financial collection scheduler unavailable for %s', market)


async def _schedule():
    while True:
        await run_scheduled_collections()
        await asyncio.sleep(POLL_SECONDS)


def start_scheduler():
    global _scheduler
    # Only the desktop backend owns this scheduler (one application process).
    if _scheduler is None or _scheduler.done():
        _scheduler = asyncio.create_task(_schedule())


async def stop_scheduler():
    tasks = [task for task in [_scheduler, *_jobs.values()] if task is not None]
    for task in tasks:
        task.cancel()
    await asyncio.gather(*tasks, return_exceptions=True)
    await stop_refreshes()
