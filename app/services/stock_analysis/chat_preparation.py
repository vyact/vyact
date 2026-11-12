"""Prepare instrument context with bounded concurrency and observable progress."""
import asyncio

PREPARATION_CONCURRENCY = 6


async def prepare_stock_chat(instruments, load_prices, load_financials=None):
    instruments = dict(instruments)
    total = len(instruments)
    completed = failed = 0
    prices, financials = {}, {}
    queue = asyncio.Queue()
    semaphore = asyncio.Semaphore(PREPARATION_CONCURRENCY)

    async def prepare(symbol):
        nonlocal completed, failed
        unavailable = False
        async with semaphore:
            try:
                prices[symbol] = await load_prices(symbol)
                unavailable = not bool(prices[symbol])
            except Exception:
                prices[symbol] = []
                unavailable = True
            if load_financials:
                try:
                    context, available = await load_financials(symbol)
                    financials[symbol] = context
                    unavailable = unavailable or not available
                except Exception:
                    financials[symbol] = f'Financial statements for {symbol}: unavailable.'
                    unavailable = True
        completed += 1
        failed += int(unavailable)
        queue.put_nowait({'type': 'preparation', 'completed': completed, 'total': total, 'failed': failed})

    tasks = [asyncio.create_task(prepare(symbol)) for symbol in instruments]
    try:
        yield {'type': 'preparation', 'completed': 0, 'total': total, 'failed': 0}
        for _ in tasks:
            yield await queue.get()
        await asyncio.gather(*tasks)
        yield {'type': 'prepared', 'prices': prices, 'financials': financials}
    finally:
        for task in tasks:
            if not task.done():
                task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
