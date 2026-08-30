import asyncio
import json

from fastapi import HTTPException
from starlette.requests import Request

from error_responses import (
    bind_request_id,
    error_code_for,
    http_exception_handler,
    public_error_payload,
    reset_request_id,
)


def _request() -> Request:
    return Request({"type": "http", "method": "GET", "path": "/api/test", "headers": []})


def test_http_exception_does_not_expose_human_or_internal_detail():
    response = asyncio.run(http_exception_handler(
        _request(),
        HTTPException(status_code=500, detail="DB password=secret connection failed"),
    ))

    body = json.loads(response.body)
    assert response.status_code == 500
    assert body["code"] == "internal_error"
    assert body["params"] == {}
    assert body["request_id"]
    assert "secret" not in response.body.decode()


def test_machine_readable_detail_code_is_preserved():
    assert error_code_for(400, "mlx_unsupported_platform") == "mlx_unsupported_platform"
    assert error_code_for(409, {"reason": "conflict", "detail": "private"}) == "conflict"


def test_stream_error_payload_contains_only_public_fields():
    payload = public_error_payload("document_index_failed", request_id="request-1")
    assert payload == {
        "code": "document_index_failed",
        "params": {},
        "request_id": "request-1",
    }


def test_stream_error_uses_bound_http_request_id():
    request = _request()
    token = bind_request_id(request)
    try:
        payload = public_error_payload("document_index_failed")
        assert payload["request_id"] == request.state.request_id
    finally:
        reset_request_id(token)
