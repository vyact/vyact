import asyncio
import json
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException
from googleapiclient.errors import HttpError
from httplib2 import Response
from starlette.requests import Request

from error_responses import google_http_error_handler
from routers.google_workspace_browser import _execute_gmail_thread_batch
from services.google_workspace.errors import is_google_rate_limited


def google_error(status: int, reason: str) -> HttpError:
    body = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HttpError(Response({"status": str(status)}), body)


@pytest.mark.parametrize("status,reason,expected", [
    (403, "rateLimitExceeded", True),
    (403, "userRateLimitExceeded", True),
    (429, "unknown", True),
    (403, "forbidden", False),
    (403, "dailyLimitExceeded", False),
    (401, "rateLimitExceeded", False),
])
def test_google_rate_limit_requires_matching_reason(status, reason, expected):
    assert is_google_rate_limited(google_error(status, reason)) is expected


def test_google_error_handler_returns_public_rate_limit_code():
    request = Request({"type": "http", "method": "GET", "path": "/api/google-workspace/mail/messages", "headers": []})
    response = asyncio.run(google_http_error_handler(request, google_error(403, "rateLimitExceeded")))
    assert response.status_code == 429
    assert json.loads(response.body)["code"] == "google_rate_limited"
    assert "rateLimitExceeded" not in response.body.decode()


def test_google_permission_error_stays_permission_error():
    request = Request({"type": "http", "method": "GET", "path": "/api/google-workspace/mail/messages", "headers": []})
    response = asyncio.run(google_http_error_handler(request, google_error(403, "forbidden")))
    assert response.status_code == 403
    assert json.loads(response.body)["code"] == "permission_denied"


def test_batch_thread_quota_failure_is_not_generic_upstream_error():
    service = MagicMock()
    quota_error = google_error(403, "rateLimitExceeded")

    def create_batch(callback):
        batch = MagicMock()
        batch.execute.side_effect = lambda: callback("thread-1", None, quota_error)
        return batch

    service.new_batch_http_request.side_effect = create_batch
    with pytest.raises(HTTPException) as caught:
        _execute_gmail_thread_batch(service, ["thread-1"], "trash")
    assert caught.value.status_code == 429
    assert caught.value.detail == "google_rate_limited"


def test_batch_thread_permission_failure_remains_upstream_error():
    service = MagicMock()
    permission_error = google_error(403, "forbidden")

    def create_batch(callback):
        batch = MagicMock()
        batch.execute.side_effect = lambda: callback("thread-1", None, permission_error)
        return batch

    service.new_batch_http_request.side_effect = create_batch
    with pytest.raises(HTTPException) as caught:
        _execute_gmail_thread_batch(service, ["thread-1"], "trash")
    assert caught.value.status_code == 502
    assert caught.value.detail == "upstream_error"
