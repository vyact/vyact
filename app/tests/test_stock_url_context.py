from unittest.mock import AsyncMock, patch

import pytest

from services.stock_analysis.url_context import build_url_chat_context


@pytest.mark.asyncio
async def test_disabled_plugin_does_not_fetch():
    with patch('services.stock_analysis.url_context.has_plugin_url_resolvers', return_value=False), \
            patch('services.stock_analysis.url_context.resolve_plugin_url', new=AsyncMock()) as resolve:
        assert await build_url_chat_context('Read https://example.com') == ''
    resolve.assert_not_awaited()


@pytest.mark.asyncio
async def test_links_are_deduplicated_limited_and_code_is_excluded():
    question = 'https://a.com https://a.com ```https://code.com``` https://b.com https://c.com https://d.com'
    with patch('services.stock_analysis.url_context.has_plugin_url_resolvers', return_value=True), \
            patch('services.stock_analysis.url_context.resolve_plugin_url', new=AsyncMock(
                return_value={'title': 'Report', 'content': 'Financial results'})) as resolve:
        context = await build_url_chat_context(question)
    assert [call.args[0] for call in resolve.await_args_list] == ['https://a.com', 'https://b.com', 'https://c.com']
    assert 'Financial results' in context
    assert 'untrusted reference data' in context


@pytest.mark.asyncio
async def test_failed_link_preserves_successful_document():
    with patch('services.stock_analysis.url_context.has_plugin_url_resolvers', return_value=True), \
            patch('services.stock_analysis.url_context.resolve_plugin_url', new=AsyncMock(side_effect=[
                {'content': 'Available report'}, {'_url_context_error': {'message': 'timeout'}}, RuntimeError('failed')])):
        context = await build_url_chat_context('https://a.com https://b.com https://c.com')
    assert 'Available report' in context
    assert context.count('"status": "unavailable"') == 2
    assert 'never invent' in context
