import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from routers import google_workspace_browser as workspace


class GoogleMailUnspamTests(unittest.IsolatedAsyncioTestCase):
    async def test_only_selected_message_is_moved_and_read_state_is_preserved(self):
        service = MagicMock()
        with patch.object(workspace, '_require_connection', AsyncMock()), patch.object(
            workspace, '_build_service', AsyncMock(return_value=service),
        ):
            self.assertEqual(await workspace.unspam_mail_message('selected'), {'ok': True})
        service.users().messages().modify.assert_called_once_with(
            userId='me', id='selected', body={'removeLabelIds': ['SPAM'], 'addLabelIds': ['INBOX']},
        )
        service.users().threads().modify.assert_not_called()

    async def test_provider_failure_is_propagated(self):
        service = MagicMock()
        service.users().messages().modify.return_value.execute.side_effect = RuntimeError('failed')
        with patch.object(workspace, '_require_connection', AsyncMock()), patch.object(
            workspace, '_build_service', AsyncMock(return_value=service),
        ):
            with self.assertRaises(RuntimeError):
                await workspace.unspam_mail_message('selected')
