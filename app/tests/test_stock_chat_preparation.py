import asyncio
from unittest.mock import AsyncMock

import pytest

from services.stock_analysis.chat_preparation import prepare_stock_chat


@pytest.mark.asyncio
async def test_progress_waits_for_financials_and_deduplicates_symbols():
    started = asyncio.Event()
    release = asyncio.Event()

    async def financials(symbol):
        started.set()
        await release.wait()
        return 'Financial context', True

    prices = AsyncMock(return_value=[{'close': 10}])
    stream = prepare_stock_chat([('AAPL', 'Apple'), ('AAPL', 'Duplicate')], prices, financials)
    assert await anext(stream) == {'type': 'preparation', 'completed': 0, 'total': 1, 'failed': 0}
    pending = asyncio.create_task(anext(stream))
    await started.wait()
    assert not pending.done()
    release.set()
    assert await pending == {'type': 'preparation', 'completed': 1, 'total': 1, 'failed': 0}
    prepared = await anext(stream)
    assert prepared['prices'] == {'AAPL': [{'close': 10}]}
    assert prepared['financials'] == {'AAPL': 'Financial context'}
    prices.assert_awaited_once_with('AAPL')
    await stream.aclose()


@pytest.mark.asyncio
async def test_missing_data_is_counted_without_preventing_analysis():
    prices = AsyncMock(side_effect=[RuntimeError('offline'), [{'close': 10}]])
    financials = AsyncMock(return_value=('Financial statements unavailable', False))
    events = [event async for event in prepare_stock_chat([('A', 'A'), ('B', 'B')], prices, financials)]
    assert events[-2] == {'type': 'preparation', 'completed': 2, 'total': 2, 'failed': 2}
    assert events[-1]['type'] == 'prepared'
    assert events[-1]['prices']['A'] == []
    assert events[-1]['prices']['B'] == [{'close': 10}]


@pytest.mark.asyncio
async def test_closing_stream_cancels_inflight_preparation():
    started = asyncio.Event()
    cancelled = asyncio.Event()

    async def prices(symbol):
        started.set()
        try:
            await asyncio.Event().wait()
        finally:
            cancelled.set()

    stream = prepare_stock_chat([('A', 'A')], prices)
    await anext(stream)
    await started.wait()
    await stream.aclose()
    assert cancelled.is_set()
