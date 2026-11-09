import copy
import json
from unittest.mock import AsyncMock, patch

import pytest

from services import mcp_config
from routers import mcp


@pytest.fixture
def stored_config():
    return {
        'servers': [
            {'id': 'a', 'type': 'filesystem', 'enabled': True, 'config': {'directories': ['/tmp']}},
            {'id': 'g', 'type': 'google_workspace', 'config': {'accounts': [{'id': 'account'}]}},
            {'id': 'b', 'type': 'browser', 'enabled': False, 'config': {}, 'prompt': 'keep'},
            {'id': 'w', 'type': 'web_search', 'config': {'api_key': 'test-secret'}},
        ],
        'removed_builtin_server_types': ['keenable'],
    }


@pytest.mark.asyncio
async def test_reorder_legacy_backup_preserves_records_and_hidden_slots(stored_config):
    # Old backups have no ordering metadata. Their JSON array is the ordering contract.
    restored = json.loads(json.dumps(stored_config))
    es = AsyncMock()
    es.get.return_value = {'_source': {'key': 'mcp', 'value': restored}, '_seq_no': 7, '_primary_term': 2}
    with patch.object(mcp_config, 'get_es', return_value=es):
        result = await mcp_config.reorder_servers(['w', 'b', 'a'])
    assert [s['id'] for s in result] == ['w', 'g', 'b', 'a']
    assert {s['id']: s for s in result} == {s['id']: s for s in stored_config['servers']}
    saved = es.index.call_args.kwargs
    assert saved['if_seq_no'] == 7 and saved['if_primary_term'] == 2
    assert saved['document']['value']['removed_builtin_server_types'] == ['keenable']
    # A subsequent load (including a JSON backup round trip) retains the saved order.
    es.get.return_value = {'found': True, '_source': json.loads(json.dumps(saved['document']))}
    with patch.object(mcp_config, 'get_es', return_value=es):
        assert await mcp_config.list_servers() == result


@pytest.mark.asyncio
@pytest.mark.parametrize('ids', [['a', 'a'], ['missing']])
async def test_invalid_order_never_saves(stored_config, ids):
    es = AsyncMock()
    es.get.return_value = {'_source': {'value': copy.deepcopy(stored_config)}}
    with patch.object(mcp_config, 'get_es', return_value=es), pytest.raises(ValueError):
        await mcp_config.reorder_servers(ids)
    es.index.assert_not_called()
    es.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_storage_failure_propagates(stored_config):
    es = AsyncMock()
    es.get.return_value = {'_source': {'value': stored_config}, '_seq_no': 1, '_primary_term': 1}
    es.index.side_effect = RuntimeError('storage failed')
    with patch.object(mcp_config, 'get_es', return_value=es), pytest.raises(RuntimeError):
        await mcp_config.reorder_servers(['b', 'a'])
    es.close.assert_awaited_once()


def test_legacy_builtin_migration_keeps_existing_order():
    cfg = {'servers': [{'id': 'old', 'type': 'custom', 'config': {'token': 'keep'}}]}
    result, changed = mcp_config._ensure_builtin_servers(cfg)
    assert changed
    assert result['servers'][0] == {'id': 'old', 'type': 'custom', 'config': {'token': 'keep'}}
    assert [s['type'] for s in result['servers'][1:]] == ['browser', 'web_search', 'keenable']


@pytest.mark.asyncio
async def test_order_api_masks_credentials_without_reconnecting(stored_config):
    with patch.object(mcp, 'reorder_servers', AsyncMock(return_value=stored_config['servers'])) as reorder, \
            patch.object(mcp, '_reconnect_bg') as reconnect:
        result = await mcp.reorder_server_list(mcp.ReorderServersReq(server_ids=['w', 'a', 'b']))
    reorder.assert_awaited_once_with(['w', 'a', 'b'])
    assert result['servers'][-1]['config']['api_key'] == '********'
    assert stored_config['servers'][-1]['config']['api_key'] == 'test-secret'
    reconnect.assert_not_called()
