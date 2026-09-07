import unittest
from unittest.mock import AsyncMock, MagicMock, patch
from fastapi import HTTPException
from routers import google_workspace_browser as workspace

class GoogleSenderFilterTests(unittest.IsolatedAsyncioTestCase):
    async def test_sender_filter_only_and_duplicate_reuse(self):
        service = MagicMock()
        service.users().messages().get.return_value.execute.return_value = {"payload": {"headers": [{"name": "From", "value": "Person <sender@example.com>"}]}}
        filters = service.users().settings().filters()
        filters.list.return_value.execute.return_value = {"filter": []}
        with patch.object(workspace, '_require_connection', AsyncMock()), patch.object(workspace, 'get_granted_scopes', AsyncMock(return_value={'https://www.googleapis.com/auth/gmail.settings.basic'})), patch.object(workspace, '_build_service', AsyncMock(return_value=service)):
            await workspace.unspam_mail_message('id')
            filters.create.assert_called_once_with(userId='me', body={'criteria': {'from': 'sender@example.com'}, 'action': {'removeLabelIds': ['SPAM']}})
            filters.list.return_value.execute.return_value = {'filter': [{'criteria': {'from': 'sender@example.com'}, 'action': {'removeLabelIds': ['SPAM']}}]}
            await workspace.unspam_mail_message('id')
            filters.create.assert_called_once()
        service.users().messages().modify.assert_not_called()
        service.users().threads().modify.assert_not_called()

    async def test_missing_scope_requires_reconnection(self):
        with patch.object(workspace, '_require_connection', AsyncMock()), patch.object(workspace, 'get_granted_scopes', AsyncMock(return_value=set())), patch.object(workspace, '_build_service', AsyncMock()) as build:
            with self.assertRaises(HTTPException) as caught:
                await workspace.unspam_mail_message('id')
            self.assertEqual(caught.exception.detail, 'gmail_filter_reconnect_required')
            build.assert_not_called()
