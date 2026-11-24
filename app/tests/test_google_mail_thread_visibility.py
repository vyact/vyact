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

    def test_sent_summary_includes_to_addresses_across_the_thread(self):
        sent, reply, _ = self.messages
        sent["payload"] = {"headers": [{"name": "To", "value": '"Doe, Jane" <jane@example.com>, team@example.com'}]}
        reply["labelIds"] = ["INBOX"]
        reply["payload"] = {"headers": [{"name": "To", "value": "me@example.com"}]}
        result = _format_mail_threads(
            {"threads": [{"id": "thread"}]},
            {"thread": {"id": "thread", "messages": [sent, reply]}}, "me@example.com", "SENT",
        )["messages"][0]
        self.assertEqual(result["threadRecipients"], [
            {"name": "Doe, Jane", "email": "jane@example.com"},
            {"name": "", "email": "team@example.com"},
            {"name": "", "email": "me@example.com"},
        ])

    def test_draft_remains_visible_without_becoming_a_sender(self):
        received = {
            "id": "received", "labelIds": ["INBOX"],
            "payload": {"headers": [{"name": "From", "value": "Sender <sender@example.com>"}]},
        }
        draft = {
            "id": "draft", "labelIds": ["DRAFT"], "snippet": "unsent reply",
            "payload": {"headers": [{"name": "From", "value": "Me <me@example.com>"}]},
        }
        for label in ["INBOX", "DRAFT", ""]:
            with self.subTest(label=label):
                result = _format_mail_threads(
                    {"threads": [{"id": "thread"}]},
                    {"thread": {"id": "thread", "messages": [received, draft]}},
                    "me@example.com", label,
                )["messages"][0]
                self.assertEqual(result["messageCount"], 2)
                self.assertIn("DRAFT", result["labelIds"])
                self.assertEqual(result["snippet"], "unsent reply")
                self.assertEqual([p["email"] for p in result["participants"]], ["sender@example.com"])

    def test_sent_participant_is_kept_when_they_also_have_a_draft(self):
        messages = [
            {"id": "sent", "labelIds": ["SENT"], "payload": {"headers": [{"name": "From", "value": "me@example.com"}]}},
            {"id": "draft", "labelIds": ["DRAFT"], "payload": {"headers": [{"name": "From", "value": "me@example.com"}]}},
        ]
        result = _format_mail_threads(
            {"threads": [{"id": "thread"}]},
            {"thread": {"id": "thread", "messages": messages}}, "me@example.com", "",
        )["messages"][0]
        self.assertEqual(len(result["participants"]), 1)
        self.assertTrue(result["participants"][0]["isMe"])
