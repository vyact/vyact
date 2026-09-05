"""Microsoft contracts: no real account or external mutations."""
import unittest
import httpx
from unittest.mock import AsyncMock, patch
from urllib.parse import parse_qs, urlsplit
from fastapi import HTTPException
from starlette.datastructures import FormData
from routers.microsoft_workspace import send_mail, bulk_mail, event_body, safe_filename, normalize_event, normalize_permission, normalize_file
from services.microsoft_workspace import auth, mail, tools


class MicrosoftWorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_login_pkce_random_state_no_secret(self):
        settings = {"client_id": "11111111-1111-1111-1111-111111111111"}
        with patch.object(auth, "account", AsyncMock(return_value=(settings, {"id": "one"}))):
            first = await auth.start_login("one", "http://localhost:8000/callback")
            second = await auth.start_login("one", "http://localhost:8000/callback")
        query = parse_qs(urlsplit(first).query)
        self.assertEqual(query["code_challenge_method"], ["S256"])
        self.assertNotIn("client_secret", query)
        self.assertNotEqual(query["state"], parse_qs(urlsplit(second).query)["state"])

    async def test_unknown_state_rejected(self):
        with self.assertRaises(HTTPException):
            await auth.complete_login("unknown", "code")

    async def test_disconnect_invalidates_pending_login(self):
        auth._pending["disconnect-test"] = {"account_id": "one"}
        with patch.object(auth, "save_token", AsyncMock()) as save:
            await auth.disconnect("one")
        self.assertNotIn("disconnect-test", auth._pending)
        save.assert_awaited_once_with("one", {})

    async def test_missing_account_does_not_fallback(self):
        with patch.object(auth, "config", AsyncMock(return_value={"active_account_id": "one", "accounts": [{"id": "one"}]})):
            with self.assertRaises(HTTPException):
                await auth.account("two")

    async def test_readonly_blocks_write_before_network(self):
        with patch.object(auth, "access_token", AsyncMock(return_value=("token", {"mail_mode": "readonly"}))), patch.object(auth.httpx, "AsyncClient") as client:
            with self.assertRaises(HTTPException) as caught:
                await auth.graph("/me/sendMail", "POST", write=True)
            self.assertEqual(caught.exception.status_code, 403)
            client.assert_not_called()

    async def test_external_graph_urls_rejected(self):
        with patch.object(auth, "access_token", AsyncMock()) as token:
            for url in ("https://evil.test", "//evil.test", "/https://evil.test"):
                with self.assertRaises(HTTPException):
                    await auth.graph(url)
            token.assert_not_awaited()

    async def test_folder_and_explicit_account(self):
        with patch.object(mail, "graph", AsyncMock(return_value={"value": []})) as graph:
            await mail.messages("TRASH", account_id="two")
            self.assertEqual(graph.call_args.args[0], "/me/mailFolders/deleteditems/messages")
            self.assertEqual(graph.call_args.kwargs["account_id"], "two")

    def test_pagination_rejects_foreign_hosts(self):
        for url in ("https://evil.test/v1.0/me/messages", "https://graph.microsoft.com.evil.test/v1.0/me/messages", "http://graph.microsoft.com/v1.0/me/messages"):
            with self.assertRaises(HTTPException):
                mail.page_path(url, "/me/")
        self.assertEqual(mail.page_path("https://graph.microsoft.com/v1.0/me/messages?$skip=30", "/me/"), "/me/messages?$skip=30")

    def test_normalization_handles_missing_fields(self):
        result = mail.normalize_message({"id": "id", "isRead": True})
        self.assertEqual(result["to"], [])
        self.assertFalse(result["isUnread"])

    def test_flags_and_html(self):
        result = mail.normalize_message({"id": "id", "isRead": False, "flag": {"flagStatus": "flagged"}, "body": {"contentType": "html", "content": "<p>Hello</p>"}})
        self.assertTrue(result["isUnread"])
        self.assertTrue(result["isStarred"])
        self.assertEqual(result["htmlBody"], "<p>Hello</p>")


class MicrosoftBrowserContractTests(unittest.IsolatedAsyncioTestCase):
    async def test_direct_send_ignores_llm_mail_mode(self):
        for mode in ("readonly", "draft_only"):
            request = AsyncMock()
            request.form.return_value = FormData({"to": "test@example.com", "subject": "QA", "body": "Test"})
            with patch.object(auth, "account", AsyncMock(return_value=({}, {"id": "one", "mail_mode": mode}))), patch.object(auth, "graph", AsyncMock(side_effect=[{"id": "draft"}, {}])) as graph:
                await send_mail(request, "one")
                self.assertEqual(graph.call_args_list[-1].args, ("/me/messages/draft/send", "POST"))
                self.assertTrue(all(not call.kwargs.get("write") for call in graph.call_args_list))

    async def test_llm_send_still_checks_mail_mode(self):
        for mode in ("readonly", "draft_only"):
            with patch.object(auth, "access_token", AsyncMock(return_value=("token", {"mail_mode": mode}))), patch.object(auth.httpx, "AsyncClient") as client:
                with self.assertRaises(HTTPException) as caught:
                    await tools.send_email("test@example.com", "QA", "Test", "one")
                self.assertEqual(caught.exception.status_code, 403)
                client.assert_not_called()

    async def test_draft_only_mode_cannot_send(self):
        with patch.object(auth, "access_token", AsyncMock(return_value=("token", {"mail_mode": "draft_only"}))), patch.object(auth.httpx, "AsyncClient") as client:
            with self.assertRaises(HTTPException):
                await auth.graph("/me/sendMail", "POST", write=True)
            client.assert_not_called()

    async def test_permanent_delete_checks_trash_before_mutating(self):
        request = AsyncMock()
        request.json.return_value = {"message_ids": ["one"]}
        with patch.object(auth, "graph", AsyncMock(side_effect=[{"parentFolderId": "inbox"}, {"id": "trash"}])) as graph:
            with self.assertRaises(HTTPException):
                await bulk_mail("messages", "delete", request, "account")
            self.assertEqual(graph.await_count, 2)
            self.assertTrue(all(len(call.args) == 1 for call in graph.call_args_list))

    def test_calendar_timezone_is_preserved_by_utc_conversion(self):
        body = event_body({"start": "2026-09-06T09:00:00+09:00", "end": "2026-09-06T10:00:00+09:00"})
        self.assertEqual(body["start"], {"dateTime": "2026-09-06T00:00:00", "timeZone": "UTC"})

    def test_all_day_event_stays_local_date(self):
        body = event_body({"start": "2026-09-06", "end": "2026-09-07", "timezone": "Asia/Seoul"})
        self.assertEqual(body["start"], {"dateTime": "2026-09-06T00:00:00", "timeZone": "Asia/Seoul"})
        self.assertTrue(body["isAllDay"])

    def test_unsupported_reminders_are_not_silently_dropped(self):
        with self.assertRaises(HTTPException):
            event_body({"reminders": [{"method": "email", "minutes": 5}]})

    def test_download_names_cannot_escape_archive(self):
        self.assertNotIn("/", safe_filename("../../private"))
        self.assertNotIn("\\", safe_filename("..\\private"))

    def test_graph_utc_dates_have_explicit_offset_for_browser(self):
        result = normalize_event({"id": "one", "start": {"dateTime": "2026-09-06T00:00:00.0000000", "timeZone": "UTC"}})
        self.assertEqual(result["start"]["dateTime"], "2026-09-06T00:00:00+00:00")


def test_calendar_html_description_is_plain_text():
    result = normalize_event({"id": "html-event", "body": {
        "contentType": "html",
        "content": "<html><head><style>.x{color:red}</style></head><body><div>QA &amp; test</div><div>Second line</div></body></html>"
    }})
    assert result["description"] == "QA & test\nSecond line"


def test_permission_reads_invitation_and_owner():
    assert normalize_permission({"id": "invite", "invitation": {"email": "guest@example.com"}, "roles": ["read"]})["emailAddress"] == "guest@example.com"
    assert normalize_permission({"id": "owner", "roles": ["owner"]}, {"displayName": "Owner", "email": "owner@example.com"})["displayName"] == "Owner"
    assert normalize_permission({"id": "group", "grantedToIdentitiesV2": [{"user": {"displayName": "Guest", "email": "guest@example.com"}}]})["displayName"] == "Guest"


def test_drive_shared_facet_survives_normalization():
    assert normalize_file({"id": "shared", "shared": {"scope": "users"}})["shared"] is True
    assert normalize_file({"id": "shared-empty", "shared": {}})["shared"] is True
    assert normalize_file({"id": "private"})["shared"] is False


class MicrosoftThrottleTests(unittest.IsolatedAsyncioTestCase):
    async def test_get_waits_for_retry_after_and_logs_error(self):
        response = httpx.Response(429, headers={"Retry-After": "3", "request-id": "graph-test"},
                                  json={"error": {"code": "TooManyRequests"}})
        client = AsyncMock()
        client.request.side_effect = [response, httpx.Response(200, json={"value": []})]
        with patch.object(auth, "access_token", AsyncMock(return_value=("secret-token", {"id": "throttle-test"}))), \
                patch.object(auth.httpx, "AsyncClient") as factory, \
                patch.object(auth.asyncio, "sleep", AsyncMock()) as sleep, \
                self.assertLogs(auth.logger, level="WARNING") as logs:
            factory.return_value.__aenter__.return_value = client
            result = await auth.graph("/me/mailFolders")
        self.assertEqual(result, {"value": []})
        sleep.assert_awaited_once_with(3)
        self.assertEqual(client.request.await_count, 2)
        self.assertIn("status=429", logs.output[0])
        self.assertIn("TooManyRequests", logs.output[0])
        self.assertNotIn("secret-token", logs.output[0])


class MicrosoftBatchWorkspaceTests(unittest.IsolatedAsyncioTestCase):
    async def test_cache_only_ids_and_fetch_latest_data_for_each_account(self):
        mail._folder_ids.clear()
        mail._folder_locks.clear()
        calls = []
        async def batch(requests, account_id):
            calls.append((dict(requests), account_id))
            result = {key: {"id": account_id + key} for key in mail.FOLDERS if key in requests}
            result["folders"] = {"value": [{"id": account_id + "INBOX", "displayName": "Inbox",
                                           "unreadItemCount": len(calls)}]}
            result["messages"] = {"value": []}
            return result
        with patch.object(mail, "account", AsyncMock(side_effect=lambda value: ({}, {"id": value}))), \
                patch.object(mail, "read_token", AsyncMock(return_value={"email": "test", "client_id": "client"})), \
                patch.object(mail, "graph_batch_get", batch):
            first = await mail.workspace(account_id="one")
            second = await mail.workspace(account_id="one")
            await mail.workspace(account_id="two")
        self.assertEqual(len(calls[0][0]), 8)
        self.assertEqual(set(calls[1][0]), {"folders", "messages"})
        self.assertEqual(len(calls[2][0]), 8)
        self.assertEqual(first["labels"][0]["unreadCount"], 1)
        self.assertEqual(second["labels"][0]["unreadCount"], 2)

    async def test_batch_retries_only_throttled_and_dependent_items(self):
        graph = AsyncMock(side_effect=[
            {"responses": [{"id": "folders", "status": 200, "body": {"value": []}},
                           {"id": "messages", "status": 429, "headers": {"Retry-After": "4"},
                            "body": {"error": {"code": "TooManyRequests"}}}]},
            {"responses": [{"id": "messages", "status": 200, "body": {"value": []}}]},
        ])
        with patch.object(auth, "graph", graph), patch.object(auth.asyncio, "sleep", AsyncMock()) as sleep:
            result = await auth.graph_batch_get({"folders": "/me/mailFolders", "messages": "/me/messages"}, "one")
        self.assertEqual(set(result), {"folders", "messages"})
        sleep.assert_awaited_once_with(4)
        self.assertEqual([r["id"] for r in graph.call_args_list[1].kwargs["json"]["requests"]], ["messages"])
        self.assertEqual(graph.call_args_list[0].kwargs["json"]["requests"][1]["dependsOn"], ["folders"])
