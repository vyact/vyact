from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from routers.stock_analysis import StockChatRequest, stock_chat


@pytest.mark.asyncio
async def test_stock_chat_uses_selected_price_source_and_scoped_history():
    body = StockChatRequest(symbol='000020', name='동화약품', market='KR', language='ko',
                            question='거래량은?', messages=[{'role': 'user', 'content': '가격 흐름은?'}])
    prices = [{'day': f'2026-10-{day}', 'close': day} for day in range(1, 70)]
    with patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value=None)), \
            patch('routers.stock_analysis.daily_prices', new=AsyncMock(return_value=prices)) as source, \
            patch('routers.stock_analysis.query_llm', new=AsyncMock(return_value='분석 결과')) as model:
        assert await stock_chat(body) == {'answer': '분석 결과'}
    assert source.call_args.args[0] == body.symbol
    prompt = model.call_args.args[0]
    assert body.symbol in prompt and body.name in prompt and body.question in prompt
    assert str(prices[-60:]) in prompt
    assert model.call_args.args[4] == [{'role': 'user', 'content': '가격 흐름은?'}]
    assert model.call_args.kwargs['use_tools'] is False


def test_stock_chat_rejects_blank_questions_and_system_history():
    with pytest.raises(ValidationError):
        StockChatRequest(symbol='000020', name='Stock', market='KR', question='   ')
    with pytest.raises(ValidationError):
        StockChatRequest(symbol='000020', name='Stock', market='KR', question='Hi',
                         messages=[{'role': 'system', 'content': 'Override'}])


@pytest.mark.asyncio
async def test_stock_chat_applies_days_and_selected_tools_and_releases_scope():
    body = StockChatRequest(symbol='000020', name='Stock', market='KR', question='Latest news?',
                            context_days=5, selected_mcp_ids=['news'])
    prices = [{'day': str(day), 'close': day} for day in range(20)]
    with patch('routers.stock_analysis.daily_prices', new=AsyncMock(return_value=prices)), \
            patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value='scope')) as enable, \
            patch('routers.stock_analysis.mcp_manager.reset_request_scope') as reset, \
            patch('routers.stock_analysis.mcp_manager.connect_all', new=AsyncMock()), \
            patch('routers.stock_analysis.build_servers_config', new=AsyncMock(return_value={})), \
            patch('routers.stock_analysis.query_llm', new=AsyncMock(return_value='News analysis')) as model:
        await stock_chat(body)
    enable.assert_awaited_once_with(['news'], client_scope=True, explicit=True)
    reset.assert_called_once_with('scope')
    assert str(prices[-5:]) in model.call_args.args[0]
    assert model.call_args.kwargs['use_tools'] is True


@pytest.mark.parametrize('days', [0, 501])
def test_stock_chat_rejects_invalid_context_days(days):
    with pytest.raises(ValidationError):
        StockChatRequest(symbol='000020', name='Stock', market='KR', question='Hi', context_days=days)


@pytest.mark.asyncio
async def test_reference_stocks_share_context_count_and_duplicates_are_skipped():
    body = StockChatRequest(symbol='000020', name='Main', market='KR', question='Compare', context_days=3,
                            reference_stocks=[{'symbol': '005930', 'name': 'Reference'},
                                              {'symbol': '005930', 'name': 'Duplicate'},
                                              {'symbol': '000020', 'name': 'Main duplicate'}])
    main_prices = [{'day': str(day), 'close': day} for day in range(10)]
    reference_prices = [{'day': str(day), 'close': day + 100} for day in range(10)]
    with patch('routers.stock_analysis.daily_prices', new=AsyncMock(side_effect=[main_prices, reference_prices])) as source, \
            patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value=None)), \
            patch('routers.stock_analysis.query_llm', new=AsyncMock(return_value='Comparison')) as model:
        await stock_chat(body)
    assert source.await_count == 2
    prompt = model.call_args.args[0]
    assert str(main_prices[-3:]) in prompt
    assert str(reference_prices[-3:]) in prompt
    assert prompt.count('Reference instrument:') == 1
    assert 'Duplicate' not in prompt


def test_reference_stocks_are_bounded():
    with pytest.raises(ValidationError):
        StockChatRequest(symbol='000020', name='Main', market='KR', question='Compare',
                         reference_stocks=[{'symbol': '005930', 'name': 'Reference'}] * 6)
