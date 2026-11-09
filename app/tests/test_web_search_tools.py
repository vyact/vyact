import asyncio
from copy import deepcopy
import json
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import HTTPException

from routers import mcp as mcp_router

from routers.mcp import _mask
from services import mcp_config, web_search_tools, web_search_credits
from services.mcp_client import MCPManager
from services.tool_approval import get_tool_risk


@pytest.fixture
def credit_store(monkeypatch):
    documents = {}
    es = AsyncMock()

    async def get(**kwargs):
        value = documents.get(kwargs['id'])
        return {'found': value is not None, '_source': deepcopy(value)}

    async def index(**kwargs):
        documents[kwargs['id']] = deepcopy(kwargs['document'])

    es.get.side_effect = get
    es.index.side_effect = index
    monkeypatch.setattr(web_search_credits, 'get_es', lambda: es)
    return documents


def credit_balance(remaining=10):
    return {'status': 'ok',
            'plan': {'used': 1000 - remaining, 'limit': 1000, 'remaining': remaining},
            'paygo': {'used': 0, 'limit': 0, 'remaining': 0},
            'key': {'used': 0, 'limit': None, 'remaining': None}}


@pytest.fixture
def setup(monkeypatch, credit_store):
    credit_store[web_search_credits._document_id('test-secret')] = {'value': credit_balance()}
    servers = [{'id': 'web', 'type': 'web_search', 'enabled': True, 'config': {'api_key': 'test-secret'}}]
    monkeypatch.setattr(web_search_tools, 'list_servers', AsyncMock(return_value=servers))
    monkeypatch.setattr(mcp_config, 'list_servers', AsyncMock(return_value=servers))
    monkeypatch.setattr(web_search_tools, 'get_tool_language', AsyncMock(return_value='en'))
    return servers


def mock_http(monkeypatch, status, payload):
    requests = []
    original_client = httpx.AsyncClient

    def handler(request):
        requests.append(request)
        return httpx.Response(status, json=payload)

    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', lambda **kwargs: original_client(
        transport=httpx.MockTransport(handler), **kwargs,
    ))
    return requests


@pytest.mark.asyncio
async def test_basic_search_cost_and_sources(monkeypatch, setup):
    requests = mock_http(monkeypatch, 200, {'results': [
        {'title': 'Biography', 'url': 'https://example.org/bio', 'content': 'Born in 1954.'},
        {'title': 'Duplicate', 'url': 'https://example.org/bio'},
        {'title': 'Unsafe', 'url': 'javascript:alert(1)'},
    ], 'usage': {'credits': 1}})
    result = await web_search_tools.web_search('Howard Buffett birth date')
    assert len(requests) == 1
    assert requests[0].headers['Authorization'] == 'Bearer test-secret'
    body = json.loads(requests[0].content)
    assert body['search_depth'] == 'basic'
    assert body['auto_parameters'] is False
    assert body['include_answer'] is False
    assert len(json.loads(result['text'])['results']) == 1
    assert result['sources'] == [{'title': 'Biography', 'url': 'https://example.org/bio', 'source': 'web'}]
    assert 'test-secret' not in str(result)


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [401, 403, 429, 432, 433, 500])
async def test_provider_errors_do_not_leak_or_retry(monkeypatch, setup, status):
    requests = mock_http(monkeypatch, status, {'detail': 'test-secret'})
    result = await web_search_tools.web_search('query')
    assert json.loads(result)['ok'] is False
    assert 'test-secret' not in result
    assert len(requests) == 1


@pytest.mark.asyncio
async def test_missing_key_and_invalid_query_do_not_request(monkeypatch, setup):
    client = AsyncMock()
    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', client)
    setup[0]['config'] = {}
    assert json.loads(await web_search_tools.web_search('query'))['ok'] is False
    assert json.loads(await web_search_tools.web_search(' '))['ok'] is False
    client.assert_not_called()


@pytest.mark.asyncio
async def test_tool_exposure_requires_key_and_enablement(setup):
    manager = MCPManager()
    web_search_tools.register_web_search_tools(manager)
    assert [tool['function']['name'] for tool in await manager.get_tools()] == ['web_search']
    setup[0]['enabled'] = False
    assert await manager.get_tools() == []
    setup[0]['enabled'] = True
    setup[0]['config'] = {}
    assert await manager.get_tools() == []
    assert get_tool_risk('web_search') == 'read'


def test_defaults_and_existing_config_migration():
    defaults = mcp_config._default_config()['servers']
    assert next(s for s in defaults if s['type'] == 'web_search')['enabled'] is False
    existing = {'id': 'existing', 'type': 'browser', 'enabled': True, 'config': {}}
    config, changed = mcp_config._ensure_builtin_servers({'servers': [existing]})
    assert changed
    assert config['servers'][0] == existing
    assert len(config['servers']) == 3
    web = config['servers'][1]
    web.update(enabled=True, config={'api_key': 'keep-me'})
    again, changed = mcp_config._ensure_builtin_servers(config)
    assert not changed
    assert again['servers'][1] == web


@pytest.mark.asyncio
@pytest.mark.parametrize('server_type', ['filesystem', 'web_search', 'browser', 'keenable'])
@pytest.mark.parametrize('legacy_config', [False, True])
async def test_deleted_builtin_stays_removed_after_reload_and_startup(monkeypatch, server_type, legacy_config):
    stored = deepcopy(mcp_config._default_config())
    if legacy_config:
        stored['servers'] = [s for s in stored['servers'] if s['type'] == 'filesystem']
    es = AsyncMock()
    es.exists.return_value = True

    async def get(**kwargs):
        return {'found': True, '_source': {'value': deepcopy(stored)}}

    async def index(**kwargs):
        nonlocal stored
        stored = deepcopy(kwargs['document']['value'])

    es.get.side_effect = get
    es.index.side_effect = index
    monkeypatch.setattr(mcp_config, 'get_es', lambda: es)
    listed = await mcp_config.list_servers()
    target = next(server for server in listed if server['type'] == server_type)
    remaining = [server for server in listed if server['id'] != target['id']]
    assert await mcp_config.list_servers() == listed

    monkeypatch.setattr(mcp_router, '_reconnect_bg', lambda: None)
    response = await mcp_router.delete_server(target['id'])
    assert response['servers'] == remaining
    assert await mcp_config.list_servers() == remaining
    assert (await mcp_config.ensure_mcp_config())['servers'] == remaining
    assert await mcp_config.list_servers() == remaining

    # Explicitly adding the tool remains possible after deleting its default entry.
    added = await mcp_config.add_server(server_type, {}, enabled=False)
    assert added in await mcp_config.list_servers()
    await mcp_config.remove_server(added['id'])
    assert await mcp_config.list_servers() == remaining


@pytest.mark.asyncio
async def test_explicit_selection_uses_configured_disabled_search(monkeypatch, setup):
    manager = MCPManager()
    web_search_tools.register_web_search_tools(manager)
    setup[0]['enabled'] = False
    monkeypatch.setattr(mcp_config, 'build_servers_config', AsyncMock(return_value={}))
    tokens = await manager.enable_request_scope(['web'])
    try:
        assert [t['function']['name'] for t in await manager.get_tools()] == ['web_search']
        setup[0]['config'] = {}
        assert await manager.get_tools() == []
    finally:
        manager.reset_request_scope(tokens)


@pytest.mark.asyncio
async def test_empty_results(monkeypatch, setup):
    mock_http(monkeypatch, 200, {'results': []})
    result = await web_search_tools.web_search('query')
    assert json.loads(result['text'])['results'] == []
    assert result['sources'] == []


def test_api_key_is_masked(setup):
    masked = _mask(setup)
    assert masked[0]['config']['api_key'] == '********'
    assert setup[0]['config']['api_key'] == 'test-secret'


@pytest.mark.asyncio
async def test_usage_separates_account_key_and_paid_credits(monkeypatch):
    requests = mock_http(monkeypatch, 200, {
        'key': {'usage': 150, 'limit': 200},
        'account': {'plan_usage': 500, 'plan_limit': 1000, 'paygo_usage': 25, 'paygo_limit': 100},
        'unexpected_secret': 'test-secret',
    })
    result = await web_search_credits.get_web_search_usage('test-secret')
    assert result == {
        'status': 'ok',
        'plan': {'used': 500, 'limit': 1000, 'remaining': 500},
        'paygo': {'used': 25, 'limit': 100, 'remaining': 75},
        'key': {'used': 150, 'limit': 200, 'remaining': 50},
    }
    assert requests[0].method == 'GET'
    assert str(requests[0].url) == web_search_credits.USAGE_URL
    assert 'test-secret' not in str(result)


@pytest.mark.parametrize('data, expected', [
    ({}, {'used': None, 'limit': None, 'remaining': None}),
    ({'used': 0, 'limit': 0}, {'used': 0, 'limit': 0, 'remaining': 0}),
    ({'used': 1200, 'limit': 1000}, {'used': 1200, 'limit': 1000, 'remaining': 0}),
    ({'used': 10, 'limit': None}, {'used': 10, 'limit': None, 'remaining': None}),
    ({'used': True, 'limit': float('inf')}, {'used': None, 'limit': None, 'remaining': None}),
])
def test_usage_does_not_invent_missing_limits(data, expected):
    assert web_search_credits._credit_summary(data, 'used', 'limit') == expected


@pytest.mark.asyncio
@pytest.mark.parametrize('status, expected', [(401, 'invalid_key'), (429, 'rate_limited'), (500, 'unavailable')])
async def test_usage_errors_are_sanitized(monkeypatch, status, expected):
    mock_http(monkeypatch, status, {'detail': 'test-secret'})
    assert await web_search_credits.get_web_search_usage('test-secret') == {'status': expected}


@pytest.mark.asyncio
async def test_usage_without_key_does_not_contact_provider(monkeypatch):
    client = AsyncMock()
    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', client)
    assert await web_search_credits.get_web_search_usage(' ') == {'status': 'missing_key'}
    client.assert_not_called()


@pytest.mark.asyncio
async def test_usage_route_uses_saved_key(monkeypatch):
    monkeypatch.setattr(mcp_router, 'list_servers', AsyncMock(return_value=[
        {'id': 'web', 'type': 'web_search', 'config': {'api_key': 'saved-secret'}},
    ]))
    usage = AsyncMock(return_value={'status': 'ok'})
    monkeypatch.setattr(mcp_router, 'refresh_web_search_usage', usage)
    assert await mcp_router.get_server_usage('web') == {'status': 'ok'}
    usage.assert_awaited_once_with('saved-secret')
    with pytest.raises(HTTPException) as error:
        await mcp_router.get_server_usage('missing')
    assert error.value.status_code == 404
    assert usage.await_count == 1


@pytest.mark.asyncio
async def test_localized_default_prompt_and_custom_override(monkeypatch, setup):
    monkeypatch.setattr(mcp_config, 'get_tool_language', AsyncMock(return_value='ko'))
    prompt = await mcp_config.get_active_mcp_prompt()
    assert prompt.startswith('최신 정보나 본문에 없는 사실은 web_search로 확인')
    setup[0]['prompt'] = 'Custom instructions'
    assert await mcp_config.get_active_mcp_prompt() == 'Custom instructions'
    setup[0]['prompt'] = ''
    assert await mcp_config.get_active_mcp_prompt() == prompt
    setup[0]['enabled'] = False
    assert await mcp_config.get_active_mcp_prompt() == ''
    assert await mcp_config.get_active_mcp_prompt({'web'}) == prompt


@pytest.mark.asyncio
async def test_web_search_key_removal_disables_and_blocks_reenable(monkeypatch):
    config = {'servers': [{'id': 'web', 'type': 'web_search', 'enabled': True,
                           'config': {'api_key': 'saved-key'}}]}
    monkeypatch.setattr(mcp_config, 'load_mcp_config', AsyncMock(return_value=config))
    save = AsyncMock()
    monkeypatch.setattr(mcp_config, 'save_mcp_config', save)
    servers = await mcp_config.update_server('web', config={'api_key': ''})
    assert servers[0]['enabled'] is False
    servers = await mcp_config.update_server('web', enabled=True)
    assert servers[0]['enabled'] is False
    servers = await mcp_config.update_server('web', config={'api_key': 'new-key'})
    assert servers[0]['enabled'] is False
    servers = await mcp_config.update_server('web', enabled=True)
    assert servers[0]['enabled'] is True
    assert save.await_count == 4


@pytest.mark.asyncio
@pytest.mark.parametrize('key', ['', '   ', 'saved-key'])
async def test_web_search_creation_requires_saved_key(monkeypatch, key):
    monkeypatch.setattr(mcp_config, 'load_mcp_config', AsyncMock(return_value={'servers': []}))
    monkeypatch.setattr(mcp_config, 'save_mcp_config', AsyncMock())
    server = await mcp_config.add_server('web_search', {'api_key': key}, enabled=True)
    assert server['enabled'] is bool(key.strip())


@pytest.mark.asyncio
async def test_exhausted_balance_hides_enabled_and_explicit_tool(monkeypatch, setup):
    await web_search_credits.save_usage('test-secret', credit_balance(0))
    manager = MCPManager()
    web_search_tools.register_web_search_tools(manager)
    assert setup[0]['enabled'] is True
    assert await manager.get_tools() == []
    monkeypatch.setattr(mcp_config, 'build_servers_config', AsyncMock(return_value={}))
    tokens = await manager.enable_request_scope(['web'])
    try:
        assert await manager.get_tools() == []
        client = AsyncMock()
        monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', client)
        assert json.loads(await web_search_tools.web_search('query'))['ok'] is False
        client.assert_not_called()
    finally:
        manager.reset_request_scope(tokens)


@pytest.mark.asyncio
async def test_last_credit_cannot_be_spent_twice(monkeypatch, setup):
    lock = asyncio.Lock()
    monkeypatch.setattr(web_search_credits, 'credit_lock', lock)
    monkeypatch.setattr(web_search_tools, 'credit_lock', lock)
    await web_search_credits.save_usage('test-secret', credit_balance(1))
    requests = mock_http(monkeypatch, 200, {'results': [], 'usage': {'credits': 1}})
    results = await asyncio.gather(*(web_search_tools.web_search('query') for _ in range(2)))
    assert sum(isinstance(result, dict) for result in results) == 1
    assert len(requests) == 1
    saved = await web_search_credits.load_usage('test-secret')
    assert saved['plan']['used'] == 1000
    assert saved['plan']['remaining'] == 0
    assert saved['key']['used'] == 1
    assert saved['estimated'] is True


@pytest.mark.parametrize('key_remaining, paygo_remaining, expected', [
    (None, 0, False), (None, 2, True), (0, 2, False), (1, 2, True),
])
def test_account_and_key_limits(key_remaining, paygo_remaining, expected):
    balance = credit_balance(0)
    balance['paygo'] = {'used': 0, 'limit': paygo_remaining, 'remaining': paygo_remaining}
    balance['key'] = {'used': 0, 'limit': key_remaining, 'remaining': key_remaining}
    assert web_search_credits.has_credits(balance) is expected
    if expected:
        updated = web_search_credits.debit_usage(balance)
        assert updated['paygo']['remaining'] == paygo_remaining - 1
        assert updated['plan']['remaining'] == 0
        assert updated['key']['used'] == 1


@pytest.mark.asyncio
async def test_refresh_replaces_estimate_and_unblocks(monkeypatch, setup):
    await web_search_credits.save_usage('test-secret', {**credit_balance(0), 'blocked': True})
    fetch = AsyncMock(return_value=credit_balance(100))
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', fetch)
    usage = await web_search_credits.refresh_web_search_usage('test-secret')
    assert usage['estimated'] is False
    assert usage['checked_at']
    assert await web_search_credits.web_search_available('test-secret')
    assert (await web_search_credits.load_usage('test-secret'))['plan']['remaining'] == 100
    assert fetch.await_count == 1


@pytest.mark.asyncio
async def test_failed_refresh_keeps_exhausted_balance(monkeypatch, setup):
    await web_search_credits.save_usage('test-secret', credit_balance(0))
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', AsyncMock(return_value={'status': 'unavailable'}))
    assert await web_search_credits.refresh_web_search_usage('test-secret') == {'status': 'unavailable'}
    assert not await web_search_credits.web_search_available('test-secret')
    assert (await web_search_credits.load_usage('test-secret'))['plan']['remaining'] == 0


@pytest.mark.asyncio
async def test_new_key_does_not_reuse_old_balance(monkeypatch, setup, credit_store):
    fetch = AsyncMock(return_value=credit_balance(0))
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', fetch)
    assert not await web_search_credits.web_search_available('new-secret')
    assert await web_search_credits.web_search_available('test-secret')
    fetch.assert_awaited_once_with('new-secret')
    assert 'test-secret' not in str(credit_store)
    assert 'new-secret' not in str(credit_store)


@pytest.mark.asyncio
@pytest.mark.parametrize('status, blocked', [(429, False), (500, False), (432, True), (433, True)])
async def test_http_failure_refunds_and_only_quota_failure_blocks(monkeypatch, setup, status, blocked):
    mock_http(monkeypatch, status, {})
    await web_search_tools.web_search('query')
    usage = await web_search_credits.load_usage('test-secret')
    assert usage['plan']['remaining'] == 10
    assert bool(usage.get('blocked')) is blocked


@pytest.mark.asyncio
async def test_key_save_refreshes_but_masked_settings_save_does_not(monkeypatch):
    server = {'id': 'web', 'type': 'web_search', 'config': {'api_key': 'old-key'}}
    monkeypatch.setattr(mcp_router, 'list_servers', AsyncMock(return_value=[server]))
    monkeypatch.setattr(mcp_router, 'update_server', AsyncMock(return_value=[server]))
    monkeypatch.setattr(mcp_router, '_reconnect_bg', lambda: None)
    refresh = AsyncMock(return_value=credit_balance())
    monkeypatch.setattr(mcp_router, 'refresh_web_search_usage', refresh)
    await mcp_router.patch_server('web', mcp_router.UpdateServerReq(config={'api_key': 'new-key'}))
    refresh.assert_awaited_once_with('new-key')
    await mcp_router.patch_server('web', mcp_router.UpdateServerReq(config={'api_key': '********'}, prompt='prompt'))
    assert refresh.await_count == 1


@pytest.mark.asyncio
async def test_storage_failure_prevents_billable_request(monkeypatch, setup):
    monkeypatch.setattr(web_search_tools, 'save_usage', AsyncMock(side_effect=RuntimeError('unavailable')))
    client = AsyncMock()
    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', client)
    assert json.loads(await web_search_tools.web_search('query'))['ok'] is False
    client.assert_not_called()


@pytest.mark.asyncio
async def test_cached_usage_read_does_not_query_provider(monkeypatch, setup):
    fetch = AsyncMock()
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', fetch)
    saved = web_search_credits.debit_usage(credit_balance())
    await web_search_credits.save_usage('test-secret', saved)
    result = await web_search_credits.get_stored_web_search_usage('test-secret')
    assert result['plan']['remaining'] == 9
    assert result['estimated'] is True
    assert result['available'] is True
    fetch.assert_not_awaited()


@pytest.mark.asyncio
async def test_ambiguous_network_failure_keeps_reserved_credit(monkeypatch, setup):
    original_client = httpx.AsyncClient

    def handler(request):
        raise httpx.ReadTimeout('uncertain response', request=request)

    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', lambda **kwargs: original_client(
        transport=httpx.MockTransport(handler), **kwargs,
    ))
    assert json.loads(await web_search_tools.web_search('query'))['ok'] is False
    assert (await web_search_credits.load_usage('test-secret'))['plan']['remaining'] == 9


@pytest.mark.asyncio
async def test_unknown_usage_is_hidden_until_successful_refresh(monkeypatch, credit_store):
    fetch = AsyncMock(return_value={'status': 'unavailable'})
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', fetch)
    assert not await web_search_credits.web_search_available('key')
    assert not await web_search_credits.web_search_available('key')
    assert fetch.await_count == 1
    fetch.return_value = credit_balance()
    await web_search_credits.refresh_web_search_usage('key')
    assert await web_search_credits.web_search_available('key')


@pytest.mark.asyncio
async def test_refresh_waits_for_inflight_search(monkeypatch, setup):
    lock = asyncio.Lock()
    monkeypatch.setattr(web_search_credits, 'credit_lock', lock)
    monkeypatch.setattr(web_search_tools, 'credit_lock', lock)
    started, release = asyncio.Event(), asyncio.Event()
    original_client = httpx.AsyncClient

    async def handler(request):
        started.set()
        await release.wait()
        return httpx.Response(200, json={'results': []})

    monkeypatch.setattr(web_search_tools.httpx, 'AsyncClient', lambda **kwargs: original_client(
        transport=httpx.MockTransport(handler), **kwargs,
    ))
    fetch = AsyncMock(return_value=credit_balance(9))
    monkeypatch.setattr(web_search_credits, 'get_web_search_usage', fetch)
    search = asyncio.create_task(web_search_tools.web_search('query'))
    await asyncio.wait_for(started.wait(), timeout=1)
    refresh = asyncio.create_task(web_search_credits.refresh_web_search_usage('test-secret'))
    try:
        await asyncio.sleep(0)
        fetch.assert_not_awaited()
    finally:
        release.set()
        await asyncio.wait_for(asyncio.gather(search, refresh), timeout=1)
    saved = await web_search_credits.load_usage('test-secret')
    assert saved['plan']['remaining'] == 9
    assert saved['estimated'] is False
