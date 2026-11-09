from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError
from routers.stock_analysis import StockChatRequest, stock_chat, stream_stock_answer


@pytest.mark.asyncio
async def test_chart_attachment_reaches_model_with_conversation_images():
    attachment = {'type': 'image', 'filename': '12345678_NVDA-chart.png'}
    body = StockChatRequest(symbol='NVDA', name='NVIDIA', market='US', question='Analyze this chart',
                            attachments=[attachment], messages=[{'role': 'user', 'content': 'Earlier chart', 'attachments': [attachment]}])
    with patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value=None)), \
            patch('routers.stock_analysis.daily_prices', new=AsyncMock(return_value=[])), \
            patch('routers.stock_analysis.query_llm', new=AsyncMock(return_value='Analysis')) as model:
        await stock_chat(body)
    assert model.call_args.args[3] == [attachment]
    assert model.call_args.args[4][0]['attachments'] == [attachment]


@pytest.mark.parametrize('filename', ['../../secret.png', '/tmp/image.png', 'image.svg', 'dir\\image.png'])
def test_chart_attachment_cannot_reference_arbitrary_paths(filename):
    with pytest.raises(ValidationError):
        StockChatRequest(symbol='NVDA', name='NVIDIA', market='US', question='Analyze',
                         attachments=[{'type': 'image', 'filename': filename}])


@pytest.mark.asyncio
async def test_streamed_chart_attachment_is_forwarded_and_saved():
    attachment = {'type': 'image', 'filename': '12345678_NVDA-chart.png'}
    body = StockChatRequest(symbol='NVDA', name='NVIDIA', market='US', question='Analyze',
                            attachments=[attachment], conversation_id='00000000-0000-0000-0000-000000000001')

    async def events(*args, **kwargs):
        yield {'type': 'token', 'text': 'Analysis'}

    with patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value=None)), \
            patch('routers.stock_analysis.get_provider_config', new=AsyncMock(return_value={'model': 'vision'})), \
            patch('routers.stock_analysis.chat_stream_with_tools', side_effect=events) as model, \
            patch('routers.stock_analysis.append_stock_conversation', new=AsyncMock()) as save:
        result = [event async for event in stream_stock_answer(body, 'prompt', 'system')]
    assert model.call_args.args[3] == [attachment]
    assert save.call_args.kwargs['attachments'] == [attachment]
    assert 'done' in result[-1]


@pytest.mark.asyncio
async def test_chart_configuration_is_included_in_current_and_historical_prompts():
    context = {
        'symbol': 'NVDA', 'name': 'NVIDIA', 'interval': 'month',
        'captured_at': '2026-11-09T16:00:00Z',
        'visible_from': '2025-01-02', 'visible_to': '2026-11-02',
        'moving_averages': [{'period': 20, 'color': '#45a65a'}],
        'indicators': [{'name': 'bollinger', 'settings': {'period': 20, 'deviation': 2}}],
        'comparisons': [{'symbol': 'KS11', 'name': 'KOSPI', 'shift': 3}],
    }
    attachment = {'type': 'image', 'filename': '12345678_NVDA-chart.png', 'chart_context': context}
    body = StockChatRequest(symbol='NVDA', name='NVIDIA', market='US', question='Analyze', attachments=[attachment],
                            messages=[{'role': 'user', 'content': 'Earlier chart', 'attachments': [attachment]}])
    with patch('routers.stock_analysis.mcp_manager.enable_request_scope', new=AsyncMock(return_value=None)), \
            patch('routers.stock_analysis.daily_prices', new=AsyncMock(return_value=[])), \
            patch('routers.stock_analysis.query_llm', new=AsyncMock(return_value='Analysis')) as model:
        await stock_chat(body)
    for prompt in [model.call_args.args[0], model.call_args.args[4][0]['content']]:
        assert '"interval": "month"' in prompt
        assert '2025-01-02' in prompt
        assert 'bollinger' in prompt
        assert '"shift": 3' in prompt
        assert 'untrusted reference data' in prompt
    assert model.call_args.args[3][0]['chart_context']['comparisons'][0]['symbol'] == 'KS11'


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
