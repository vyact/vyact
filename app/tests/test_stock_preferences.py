from unittest.mock import AsyncMock, patch

import httpx
import pytest
from elasticsearch import NotFoundError
from fastapi import FastAPI, Response

from routers import stock_preferences as preferences
from services.db import SETTINGS_INDEX


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint,items,key', [
    ('groups', [{'id': 'kr-theme', 'market': 'KR', 'name': '반도체', 'symbols': ['005930', '000660']}], 'stock_analysis_groups'),
    ('watchlist', ['KR:005930', 'US:NVDA', 'JP:7203.T'], 'stock_analysis_watchlist'),
    ('saved-questions/stock', [{'id': 'one', 'title': 'Review', 'question': 'Review this stock'}], 'stock_analysis_questions_stock'),
    ('saved-questions/groups', [{'id': 'one', 'title': 'Compare', 'question': 'Compare these groups'}], 'stock_analysis_questions_groups'),
])
async def test_preferences_roundtrip_and_empty_list(endpoint, items, key):
    es = AsyncMock()
    es.get.return_value = {'_source': {'value': {'items': items}}}
    app = FastAPI()
    app.include_router(preferences.router)
    with patch.object(preferences, 'get_es', return_value=es):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            response = await client.get('/' + endpoint)
            assert response.json() == {'items': items}
            assert response.headers['cache-control'] == 'no-store'
            assert (await client.put('/' + endpoint, json={'items': items})).status_code == 200
            es.index.assert_awaited_with(index=SETTINGS_INDEX, id=key,
                                        document={'key': key, 'value': {'items': items}}, refresh='wait_for')
            assert (await client.put('/' + endpoint, json={'items': []})).status_code == 200
            es.get.return_value = {'_source': {'value': {'items': []}}}
            assert (await client.get('/' + endpoint)).json() == {'items': []}
    assert es.close.await_count == 4


@pytest.mark.asyncio
async def test_only_a_missing_document_allows_cache_migration():
    es = AsyncMock()
    es.get.side_effect = NotFoundError('missing', {}, {})
    with patch.object(preferences, 'get_es', return_value=es):
        assert await preferences.get_watchlist(Response()) == {'items': None}
        es.get.side_effect = RuntimeError('offline')
        with pytest.raises(RuntimeError):
            await preferences.get_watchlist(Response())
    es.index.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize('endpoint,items', [
    ('groups', [{'id': 'a', 'market': 'INVALID', 'name': 'Theme', 'symbols': []}]),
    ('groups', [{'id': 'a', 'market': 'KR', 'name': ' ', 'symbols': []}]),
    ('groups', [{'id': 'a', 'market': 'KR', 'name': 'Theme', 'symbols': ['../../bad']}]),
    ('watchlist', ['invalid']),
    ('saved-questions/stock', [{'id': 'one', 'title': ' ', 'question': 'Review'}]),
    ('saved-questions/groups', [{'id': 'one', 'title': 'Review', 'question': 'x' * 4001}]),
])
async def test_invalid_preferences_do_not_reach_es(endpoint, items):
    app = FastAPI()
    app.include_router(preferences.router)
    with patch.object(preferences, 'get_es') as es:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            assert (await client.put('/' + endpoint, json={'items': items})).status_code == 422
    es.assert_not_called()
