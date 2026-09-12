import unittest
from unittest.mock import AsyncMock, MagicMock, patch

from routers import google_workspace_browser as workspace


class GoogleMailMoveTests(unittest.IsolatedAsyncioTestCase):
    async def test_move_to_trash_uses_dedicated_api(self):
        for source in ("INBOX", "SPAM", "Label_work"):
            with self.subTest(source=source):
                service = MagicMock()
                with patch.object(workspace, "_require_connection", AsyncMock()), patch.object(
                    workspace, "_build_service", AsyncMock(return_value=service)
                ):
                    result = await workspace.move_mail_threads(workspace.MailBulkMoveRequest(
                        thread_ids=["thread-1", "thread-1"],
                        source_label_id=source,
                        target_label_id="TRASH",
                        source_is_user_label=source == "Label_work",
                    ))
                threads = service.users().threads()
                threads.trash.assert_called_once_with(userId="me", id="thread-1")
                threads.trash.return_value.execute.assert_called_once()
                threads.modify.assert_not_called()
                threads.untrash.assert_not_called()
                self.assertEqual(result, {"ok": True, "moved": 1})

    async def test_move_labels_do_not_conflict(self):
        cases = [
            ("INBOX", "SPAM", False, ["INBOX"]),
            ("SPAM", "INBOX", False, ["SPAM"]),
            ("INBOX", "Label_work", False, ["SPAM", "INBOX"]),
            ("Label_work", "SPAM", True, ["INBOX", "Label_work"]),
            ("TRASH", "SPAM", False, ["INBOX"]),
        ]
        for source, target, source_is_user_label, removed in cases:
            with self.subTest(source=source, target=target):
                service = MagicMock()
                with patch.object(workspace, "_require_connection", AsyncMock()), patch.object(
                    workspace, "_build_service", AsyncMock(return_value=service)
                ):
                    result = await workspace.move_mail_threads(workspace.MailBulkMoveRequest(
                        thread_ids=["thread-1"],
                        source_label_id=source,
                        target_label_id=target,
                        source_is_user_label=source_is_user_label,
                    ))
                threads = service.users().threads()
                threads.modify.assert_called_once_with(
                    userId="me", id="thread-1",
                    body={"addLabelIds": [target], "removeLabelIds": removed},
                )
                threads.modify.return_value.execute.assert_called_once()
                self.assertNotIn(target, removed)
                self.assertEqual(result, {"ok": True, "moved": 1})
                if source == "TRASH":
                    threads.untrash.assert_called_once_with(userId="me", id="thread-1")
                else:
                    threads.untrash.assert_not_called()
