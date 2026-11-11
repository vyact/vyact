from unittest.mock import AsyncMock, patch

import httpx
import pytest
from elasticsearch import NotFoundError
from fastapi import FastAPI

from routers import stock_analysis as router
from services.db import SETTINGS_INDEX
from routers.backup import _BACKUP_EXCLUDED_INDICES, _UPSERT_INDICES, _preserve_machine_local_config

ITEMS = [{'market': 'TW', 'symbol': 'TWII'}, {'market': 'US', 'symbol': 'GSPC'}]


@pytest.mark.asyncio
async def test_es_roundtrip_preserves_order_and_explicit_empty_list():
    es = AsyncMock()
    es.get.return_value = {'_source': {'value': {'items': ITEMS}}}
    with patch.object(router, 'get_es', return_value=es):
        assert await router.get_pinned_indices() == {'items': ITEMS}
        await router.save_pinned_indices(router.PinnedIndexPreferences(items=ITEMS))
        es.index.assert_awaited_with(index=SETTINGS_INDEX, id=router.PINNED_INDICES_DOCUMENT_ID,
                                    document={'key': router.PINNED_INDICES_DOCUMENT_ID, 'value': {'items': ITEMS}}, refresh='wait_for')
        es.get.return_value = {'_source': {'value': {'items': []}}}
        assert await router.get_pinned_indices() == {'items': []}
    assert es.close.await_count == 3


@pytest.mark.asyncio
async def test_only_missing_document_allows_local_migration():
    es = AsyncMock()
    es.get.side_effect = NotFoundError('missing', {}, {})
    with patch.object(router, 'get_es', return_value=es):
        assert await router.get_pinned_indices() == {'items': None}
    es.get.side_effect = RuntimeError('offline')
    with patch.object(router, 'get_es', return_value=es), pytest.raises(RuntimeError):
        await router.get_pinned_indices()
    es.index.assert_not_awaited()
    assert es.close.await_count == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('items', [[{'market': 'US', 'symbol': 'TWII'}], [ITEMS[0], ITEMS[0]], [{'market': 'US', 'symbol': 'AAPL'}]])
async def test_invalid_preferences_never_reach_es(items):
    app = FastAPI()
    app.include_router(router.router)
    with patch.object(router, 'get_es') as es:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.put('/stock-analysis/pinned-indices', json={'items': items})
    assert response.status_code == 422
    es.assert_not_called()


def test_settings_backup_restore_retains_pinned_order():
    assert SETTINGS_INDEX not in _BACKUP_EXCLUDED_INDICES
    assert SETTINGS_INDEX in _UPSERT_INDICES
    backup = {'indices': {SETTINGS_INDEX: {'docs': [{
        '_id': router.PINNED_INDICES_DOCUMENT_ID,
        '_source': {'key': router.PINNED_INDICES_DOCUMENT_ID, 'value': {'items': ITEMS}},
    }]}}}
    _preserve_machine_local_config(backup, {})
    restored = backup['indices'][SETTINGS_INDEX]['docs'][0]['_source']['value']
    assert router.PinnedIndexPreferences.model_validate(restored).model_dump() == {'items': ITEMS}
