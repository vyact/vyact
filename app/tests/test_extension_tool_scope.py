import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest
from fastapi import WebSocketDisconnect
from routers import browser_extension

from services import extension_tools, mcp_config
from services.mcp_client import MCPManager
from services.user_memory import memory_enabled_for_turn


@pytest.fixture
def scope_setup(monkeypatch):
    servers = [
        {'id': 'browser', 'type': 'browser', 'enabled': True},
        {'id': 'news', 'type': 'naver_news', 'enabled': False},
        {'id': 'custom1', 'type': 'custom', 'enabled': False},
        {'id': 'custom2', 'type': 'custom', 'enabled': True},
    ]
    monkeypatch.setattr(mcp_config, 'list_servers', AsyncMock(return_value=servers))
    monkeypatch.setattr(mcp_config, 'build_servers_config', AsyncMock(return_value={}))
    manager = MCPManager()
    manager.connect_all = AsyncMock()
    manager.register_internal_tool('browser_read', '', {}, AsyncMock(return_value='browser'), server_type='browser')
    manager.register_internal_tool('news_search', '', {}, AsyncMock(return_value='news'), server_type='naver_news')
    manager.register_internal_tool('code_read_file', '', {}, AsyncMock(), server_type='code_tools')
    manager.register_internal_tool('unscoped', '', {}, AsyncMock())
    for server_id in ('custom1', 'custom2'):
        manager._workers[server_id] = SimpleNamespace(cfg={'_server_id':server_id}, server=SimpleNamespace(
            name=server_id, tools=[SimpleNamespace(name='search',description='',inputSchema={})],
            session=SimpleNamespace(call_tool=AsyncMock(return_value=SimpleNamespace(content=[])))))
    return manager


@pytest.mark.asyncio
async def test_extension_preferences_override_desktop_without_mutating_it(scope_setup):
    manager = scope_setup
    token = await manager.enable_request_scope(['news','custom1'], client_scope=True, explicit=False)
    try:
        assert not manager.has_request_scope()
        assert manager.get_request_scope_server_ids() == {'news','custom1'}
        names = {tool['function']['name'] for tool in await manager.get_tools()}
        assert names == {'news_search','custom1__search'}
        assert await manager.call_tool('news_search', {}) == 'news'
        await manager.call_tool('browser_read', {})
        manager._internal_tools['browser_read']['handler'].assert_not_awaited()
    finally:
        manager.reset_request_scope(token)
    assert manager.get_request_scope_server_ids() is None
    assert not manager._scope_refs
    assert 'browser_read' in {tool['function']['name'] for tool in await manager.get_tools()}


@pytest.mark.asyncio
@pytest.mark.parametrize('ids', [[], ['deleted']])
async def test_empty_or_removed_client_selection_does_not_fall_back(scope_setup, ids):
    token = await scope_setup.enable_request_scope(ids, client_scope=True, explicit=True)
    try:
        assert await scope_setup.get_tools() == []
    finally:
        scope_setup.reset_request_scope(token)


@pytest.mark.asyncio
async def test_ordinary_extension_chat_exposes_only_memory_without_selected_tools(scope_setup, monkeypatch):
    manager = scope_setup
    manager.register_internal_tool('user_memory_list', '', {}, AsyncMock(return_value='memory'))
    monkeypatch.setattr('services.user_memory_tools.mcp_manager', manager)
    enabled_token = memory_enabled_for_turn.set(True)
    try:
        token = await manager.enable_request_scope([], client_scope=True, allow_memory_tools=True)
        try:
            assert manager.client_memory_scope_enabled()
            assert {tool['function']['name'] for tool in await manager.get_tools()} == {'user_memory_list'}
        finally:
            manager.reset_request_scope(token)
        token = await manager.enable_request_scope([], client_scope=True)
        try:
            assert await manager.get_tools() == []
        finally:
            manager.reset_request_scope(token)
    finally:
        memory_enabled_for_turn.reset(enabled_token)


@pytest.mark.asyncio
async def test_catalog_hides_uninstalled_plugin_and_only_missing_key_disables(monkeypatch):
    monkeypatch.setattr(extension_tools, 'list_servers', AsyncMock(return_value=[
        {'id':'search','type':'web_search','enabled':False,'config':{'api_key':'secret'}},
        {'id':'empty','type':'web_search','enabled':True,'config':{}},
        {'id':'gone','type':'removed_plugin','config':{}},
        {'id':'custom','type':'custom','config':{'name':'My tool','env':{'TOKEN':'secret'}}},
    ]))
    result = await extension_tools.extension_tool_catalog()
    assert [item['id'] for item in result] == ['search','empty','custom']
    assert result[0]['can_enable'] is True
    assert result[1]['can_enable'] is False
    assert result[2]['name'] == 'My tool'
    assert 'secret' not in str(result)
    assert all('enabled' not in item for item in result)


@pytest.mark.asyncio
async def test_websocket_sends_only_changed_credential_free_catalog(monkeypatch):
    socket = SimpleNamespace(client=SimpleNamespace(host='127.0.0.1'), headers={},
                             accept=AsyncMock(), send_json=AsyncMock(),
                             receive_json=AsyncMock(side_effect=[{'type':'hello'}, {'type':'ping'}, {'type':'ping'}, WebSocketDisconnect()]))
    catalog = AsyncMock(side_effect=[[{'id':'web','can_enable':True}], [{'id':'web','can_enable':True}], [{'id':'web','can_enable':False}]])
    monkeypatch.setattr(browser_extension,'extension_tool_catalog',catalog)
    await browser_extension.browser_websocket(socket)
    updates = [call.args[0] for call in socket.send_json.call_args_list if call.args[0]['type']=='tools_changed']
    assert len(updates) == 2
    assert updates[-1]['servers'][0]['can_enable'] is False


@pytest.mark.asyncio
async def test_parallel_client_scopes_do_not_leak(scope_setup):
    manager = scope_setup
    both_started = asyncio.Event()
    started = 0

    async def request(server_id, expected):
        nonlocal started
        token = await manager.enable_request_scope([server_id], client_scope=True, explicit=False)
        try:
            started += 1
            if started == 2:
                both_started.set()
            await asyncio.wait_for(both_started.wait(), timeout=1)
            assert {tool['function']['name'] for tool in await manager.get_tools()} == {expected}
        finally:
            manager.reset_request_scope(token)

    await asyncio.gather(request('news','news_search'), request('custom1','custom1__search'))
    assert manager.get_request_scope_server_ids() is None
    assert manager._scope_refs == {}
