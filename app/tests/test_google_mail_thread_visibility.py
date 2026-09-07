import unittest

from services.google_workspace.gmail import _format_mail_threads, visible_mail_thread_messages


class GoogleMailThreadVisibilityTests(unittest.TestCase):
    def setUp(self):
        self.messages = [
            {"id": "sent", "labelIds": ["SENT"], "snippet": "original"},
            {"id": "spam", "labelIds": ["SPAM", "UNREAD"], "snippet": "spam reply"},
            {"id": "trash", "labelIds": ["TRASH", "UNREAD"]},
        ]

    def test_sent_summary_does_not_use_hidden_spam_reply(self):
        result = _format_mail_threads(
            {"threads": [{"id": "thread"}]},
            {"thread": {"id": "thread", "messages": self.messages}}, "", "SENT",
        )["messages"][0]
        self.assertEqual(result["messageCount"], 1)
        self.assertFalse(result["isUnread"])
        self.assertEqual(result["snippet"], "original")

    def test_special_folders_show_only_their_own_messages(self):
        for label, expected in [("SPAM", "spam"), ("TRASH", "trash"), ("SENT", "sent"), ("", "sent")]:
            with self.subTest(label=label):
                self.assertEqual([message["id"] for message in visible_mail_thread_messages(self.messages, label)], [expected])

    def test_normal_reply_remains_in_conversation(self):
        self.messages[1]["labelIds"] = ["INBOX", "UNREAD"]
        self.assertEqual([message["id"] for message in visible_mail_thread_messages(self.messages, "INBOX")], ["sent", "spam"])
