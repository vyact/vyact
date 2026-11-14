from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.stock_analysis.group_chat_context import build_group_chat_context, select_context_prices


@pytest.mark.asyncio
async def test_groups_keep_membership_and_deduplicate_prices_with_dated_returns():
    stock = SimpleNamespace(symbol='005930', name='Samsung')
    groups = [SimpleNamespace(name='AI', stocks=[stock]), SimpleNamespace(name='Chips', stocks=[stock])]
    prices = AsyncMock(return_value=[{'day': '2026-11-09', 'close': 50},
                                    {'day': '2026-11-10', 'close': 100},
                                    {'day': '2026-11-11', 'close': 110}])
    context, symbols = await build_group_chat_context(groups, 2, prices)
    prices.assert_awaited_once_with('005930')
    assert symbols == ['005930']
    assert 'AI' in context and 'Chips' in context
    assert '2026-11-09' not in context
    assert '2026-11-10' in context and '2026-11-11' in context
    assert '"observations": 2' in context
    assert '10.0' in context


@pytest.mark.asyncio
async def test_missing_stock_data_does_not_prevent_group_analysis():
    stocks = [SimpleNamespace(symbol='005930', name='Samsung'), SimpleNamespace(symbol='000660', name='SK')]
    prices = AsyncMock(side_effect=[RuntimeError('unavailable'), [{'day': '2026-11-11', 'close': 100}]])
    context, symbols = await build_group_chat_context([SimpleNamespace(name='AI', stocks=stocks)], 60, prices)
    assert symbols == ['005930', '000660']
    assert 'Price data unavailable' in context
    assert '2026-11-11' in context


def test_date_range_filters_inclusively_before_applying_limit():
    rows = [{'day': f'2026-11-{day:02}', 'close': day} for day in range(1, 11)]
    assert [row['day'] for row in select_context_prices(rows, 2, '2026-11-03', '2026-11-06')] == ['2026-11-05', '2026-11-06']
    assert select_context_prices(rows, 500, '2026-10-01', '2026-10-31') == []
    assert select_context_prices(rows, 500, '2026-11-03', '2026-11-03') == [rows[2]]
