import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from routers import google_workspace_browser as google
from services.microsoft_workspace import mail as microsoft


class MailNotificationLocationTests(unittest.IsolatedAsyncioTestCase):
    async def test_google_auto_isolates_trash_and_spam(self):
        for folder in ['TRASH', 'SPAM', 'INBOX', 'SENT', 'ALL_MAIL']:
            with self.subTest(folder=folder):
                service = MagicMock()
                target = {'id': 'target', 'threadId': 'thread', 'labelIds': [folder], 'payload': {}}
                service.users().messages().get.return_value.execute.return_value = target
                service.users().threads().get.return_value.execute.return_value = {
                    'messages': [target, {'id': 'other', 'labelIds': ['INBOX'], 'payload': {}}]}
                service.users().getProfile.return_value.execute.return_value = {'emailAddress': 'me@example.com'}
                with patch.object(google, '_require_connection', AsyncMock()), patch.object(
                    google, '_build_service', AsyncMock(return_value=service)
                ):
                    result = await google.get_mail_message('target', 'AUTO')
                self.assertEqual(result['locationLabel'], folder)
                ids = [message['id'] for message in result['threadMessages']]
                self.assertIn('target', ids)
                if folder in {'TRASH', 'SPAM'}:
                    self.assertNotIn('other', ids)

    async def test_microsoft_resolves_system_and_custom_folders(self):
        key = ('account', 'client', 'email')
        for folder_id, expected in [('deleted-id', 'TRASH'), ('inbox-id', 'INBOX'), ('custom-id', 'custom-id')]:
            with self.subTest(folder=folder_id), patch.object(microsoft, 'graph', AsyncMock(side_effect=[
                {'id': 'target', 'parentFolderId': folder_id}, {'value': []}
            ])), patch.object(microsoft, 'account', AsyncMock(return_value=({}, {'id': 'account'}))), patch.object(
                microsoft, 'read_token', AsyncMock(return_value={})
            ), patch.object(microsoft, '_folder_context', AsyncMock(return_value=('account', key))), patch.dict(
                microsoft._folder_ids, {key: (float('inf'), {'TRASH': 'deleted-id', 'INBOX': 'inbox-id'})}
            ):
                result = await microsoft.message('target', 'account')
                self.assertEqual(result['locationLabel'], expected)
