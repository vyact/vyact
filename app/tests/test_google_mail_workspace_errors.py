import unittest
from unittest.mock import MagicMock

from googleapiclient.errors import HttpError
from httplib2 import Response

from services.google_workspace.gmail import load_mail_workspace_sync, list_mail_threads_sync


class GoogleMailWorkspaceErrorTests(unittest.TestCase):
    def make_service(self, failed_request=None):
        service = MagicMock()
        quota_error = HttpError(
            Response({"status": "403"}),
            b'{"error":{"message":"Quota exceeded","errors":[{"reason":"rateLimitExceeded"}]}}',
        )
        responses = {
            "labels": {"labels": [{"id": "INBOX", "name": "INBOX", "type": "system"}]},
            "threads": {"threads": [{"id": "thread-1"}]},
            "label:INBOX": {"messagesUnread": 0},
            "profile:me": {"emailAddress": "test@example.com"},
            "profile": {"emailAddress": "test@example.com"},
            "thread:thread-1": {"id": "thread-1", "messages": []},
            "thread-1": {"id": "thread-1", "messages": []},
        }

        def create_batch(callback):
            batch = MagicMock()
            request_ids = []
            batch.add.side_effect = lambda request, request_id: request_ids.append(request_id)

            def execute():
                for request_id in request_ids:
                    if request_id == failed_request:
                        callback(request_id, None, quota_error)
                    else:
                        callback(request_id, responses[request_id], None)

            batch.execute.side_effect = execute
            return batch

        service.new_batch_http_request.side_effect = create_batch
        service.users().threads().list.return_value.execute.return_value = responses["threads"]
        return service, quota_error, responses

    def test_workspace_batch_failures_are_not_empty_successes(self):
        for failed_request in ("labels", "threads", "thread:thread-1", "label:INBOX", "profile:me"):
            with self.subTest(failed_request=failed_request):
                service, quota_error, _ = self.make_service(failed_request)
                with self.assertRaises(HttpError) as caught:
                    load_mail_workspace_sync(service)
                self.assertIs(caught.exception, quota_error)
                service.users().threads().list.return_value.execute.assert_not_called()
                service.users().labels().list.return_value.execute.assert_not_called()
                if failed_request in ("labels", "threads"):
                    self.assertEqual(service.new_batch_http_request.call_count, 1)

    def test_empty_mailbox_keeps_labels(self):
        service, _, responses = self.make_service()
        responses["threads"] = {}
        result = load_mail_workspace_sync(service)
        self.assertEqual(result["messages"], [])
        self.assertEqual(result["labels"][0]["id"], "INBOX")

    def test_next_page_batch_failure_is_propagated(self):
        service, quota_error, _ = self.make_service("thread-1")
        with self.assertRaises(HttpError) as caught:
            list_mail_threads_sync(service, page_token="next")
        self.assertIs(caught.exception, quota_error)
        service.users().threads().get.return_value.execute.assert_not_called()
