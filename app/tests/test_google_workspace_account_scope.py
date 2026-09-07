import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from routers import google_workspace_browser as workspace


class GoogleWorkspaceAccountScopeTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_knowledge_index_account_is_preserved(self):
        with patch.object(workspace, 'build_google_service', AsyncMock()) as build:
            await workspace._build_service('gmail', 'v1', account_id='indexed-account')
            build.assert_awaited_once_with('gmail', 'v1', account_id='indexed-account')

    async def test_concurrent_http_requests_keep_their_account(self):
        app = FastAPI()
        app.include_router(workspace.router)
        arrived = 0
        both_arrived = asyncio.Event()

        async def connection():
            nonlocal arrived
            arrived += 1
            if arrived == 2:
                both_arrived.set()
            await both_arrived.wait()

        async def build_service(name, version, account_id=None):
            return account_id

        with patch.object(workspace, '_require_connection', connection), patch.object(
            workspace, 'build_google_service', AsyncMock(side_effect=build_service),
        ), patch.object(workspace, 'load_mail_workspace_sync', side_effect=lambda service, *args: {'account': service}):
            async with AsyncClient(transport=ASGITransport(app=app), base_url='http://test') as client:
                responses = await asyncio.wait_for(asyncio.gather(*[
                    client.get('/google-workspace/mail/workspace', params={'account_id': account})
                    for account in ['first', 'second']
                ]), timeout=5)
        self.assertEqual([response.json() for response in responses], [{'account': 'first'}, {'account': 'second'}])
        self.assertIsNone(workspace._request_account_id.get())

    async def test_auth_checks_requested_account_instead_of_global_active_account(self):
        scope = workspace._bind_request_account('requested')
        await anext(scope)
        try:
            with patch.object(workspace, 'check_auth_status', AsyncMock(return_value=True)) as check:
                await workspace._require_connection()
                check.assert_awaited_once_with('requested')
        finally:
            await scope.aclose()
