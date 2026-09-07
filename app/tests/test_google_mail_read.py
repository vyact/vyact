"""Conversation read persistence without accessing a real Gmail account."""
import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from routers import google_workspace_browser as workspace
from services.google_workspace.gmail import _format_mail_threads


class GoogleMailReadTests(unittest.IsolatedAsyncioTestCase):
    async def test_opening_conversation_clears_older_unread_message_on_refresh(self):
        thread = {
            "id": "conversation",
            "messages": [
                {"id": "older", "labelIds": ["INBOX", "UNREAD", "STARRED"]},
                {"id": "latest", "labelIds": ["INBOX"]},
            ],
        }

        def refreshed_mail():
            return _format_mail_threads(
                {"threads": [{"id": thread["id"]}]},
                {thread["id"]: thread}, "me@example.com", "INBOX",
            )["messages"][0]

        def modify_thread(**kwargs):
            self.assertEqual(kwargs["id"], thread["id"])
            for message in thread["messages"]:
                message["labelIds"] = [
                    label for label in message["labelIds"]
                    if label not in kwargs["body"]["removeLabelIds"]
                ]
            return MagicMock()

        service = MagicMock()
        service.users().messages().get.return_value.execute.return_value = {"threadId": thread["id"]}
        service.users().threads().modify.side_effect = modify_thread
        self.assertTrue(refreshed_mail()["isUnread"])
        with patch.object(workspace, "_require_connection", AsyncMock()), patch.object(
            workspace, "_build_service", AsyncMock(return_value=service),
        ):
            self.assertEqual(await workspace.mark_mail_message_read("latest"), {"ok": True})

        refreshed = refreshed_mail()
        self.assertFalse(refreshed["isUnread"])
        self.assertTrue(refreshed["isStarred"])
        self.assertIn("INBOX", refreshed["labelIds"])
        service.users().messages().modify.assert_not_called()

    async def test_provider_failure_is_not_reported_as_read_success(self):
        service = MagicMock()
        service.users().messages().get.return_value.execute.return_value = {"threadId": "conversation"}
        service.users().threads().modify.return_value.execute.side_effect = RuntimeError("read failed")
        with patch.object(workspace, "_require_connection", AsyncMock()), patch.object(
            workspace, "_build_service", AsyncMock(return_value=service),
        ):
            with self.assertRaisesRegex(RuntimeError, "read failed"):
                await workspace.mark_mail_message_read("latest")
