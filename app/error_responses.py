"""Public API error responses without leaking internal exception messages."""

import re
import uuid
from contextvars import ContextVar, Token
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException

from logger import get_logger

logger = get_logger(__name__)

_request_id_context: ContextVar[str | None] = ContextVar("request_id", default=None)

_MACHINE_CODE = re.compile(r"^[a-z][a-z0-9_]{2,80}$")
_STATUS_CODES = {
    400: "invalid_request",
    401: "authentication_required",
    403: "permission_denied",
    404: "resource_not_found",
    409: "conflict",
    413: "payload_too_large",
    422: "validation_failed",
    429: "rate_limited",
    500: "internal_error",
    502: "upstream_error",
    503: "service_unavailable",
    504: "request_timeout",
}


def request_id_for(request: Request) -> str:
    request_id = getattr(request.state, "request_id", None)
    if request_id:
        return request_id
    request_id = uuid.uuid4().hex
    request.state.request_id = request_id
    return request_id


def bind_request_id(request: Request) -> Token[str | None]:
    request_id = request_id_for(request)
    return _request_id_context.set(request_id)


def reset_request_id(token: Token[str | None]) -> None:
    _request_id_context.reset(token)


def error_code_for(status_code: int, detail: Any = None) -> str:
    if isinstance(detail, str) and _MACHINE_CODE.fullmatch(detail):
        return detail
    if isinstance(detail, dict):
        candidate = detail.get("code") or detail.get("reason")
        if isinstance(candidate, str) and _MACHINE_CODE.fullmatch(candidate):
            return candidate
    return _STATUS_CODES.get(status_code, "request_failed" if status_code < 500 else "internal_error")


def public_error_payload(code: str, *, request_id: str | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    return {
        "code": code,
        "params": params or {},
        "request_id": request_id or _request_id_context.get() or uuid.uuid4().hex,
    }


async def http_exception_handler(request: Request, error: HTTPException) -> JSONResponse:
    request_id = request_id_for(request)
    code = error_code_for(error.status_code, error.detail)
    logger.info("API error request=%s status=%s code=%s", request_id, error.status_code, code)
    return JSONResponse(
        status_code=error.status_code,
        content=public_error_payload(code, request_id=request_id),
        headers={**(error.headers or {}), "X-Request-ID": request_id},
    )


async def validation_exception_handler(request: Request, error: RequestValidationError) -> JSONResponse:
    request_id = request_id_for(request)
    logger.info("API validation error request=%s errors=%s", request_id, error.errors())
    return JSONResponse(
        status_code=422,
        content=public_error_payload("validation_failed", request_id=request_id),
        headers={"X-Request-ID": request_id},
    )


async def unhandled_exception_handler(request: Request, error: Exception) -> JSONResponse:
    request_id = request_id_for(request)
    logger.exception("Unhandled API error request=%s", request_id, exc_info=error)
    return JSONResponse(
        status_code=500,
        content=public_error_payload("internal_error", request_id=request_id),
        headers={"X-Request-ID": request_id},
    )
