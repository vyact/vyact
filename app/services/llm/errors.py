"""
services/llm/errors.py — provider HTTP 에러 메시지 변환
"""
import httpx

from .messages import llm_message


HTTP_ERROR_BODY_LOG_LIMIT = 4_000
MODEL_IMAGE_UNSUPPORTED_ERROR = "this model does not support image input"
INSUFFICIENT_MEMORY_ERROR_MARKERS = (
    "out of memory",
    "insufficient memory",
    "not enough memory",
    "does not fit under the dynamic memory ceiling",
    "memory ceiling",
    "cuda out of memory",
    "metal out of memory",
    "failed to allocate memory",
    "memory allocation failed",
)


def is_insufficient_memory_message(value: object) -> bool:
    """Identify common local-runtime out-of-memory messages."""
    normalized = " ".join(str(value).strip().lower().split())
    return any(marker in normalized for marker in INSUFFICIENT_MEMORY_ERROR_MARKERS)


def http_error_response_body(error: httpx.HTTPStatusError) -> str:
    """Return a bounded provider error body suitable for application logs."""
    response = error.response
    try:
        body = response.text.strip()
    except Exception:
        body = "<응답 본문을 읽을 수 없음>"
    if not body:
        return "<빈 응답 본문>"
    if len(body) > HTTP_ERROR_BODY_LOG_LIMIT:
        return f"{body[:HTTP_ERROR_BODY_LOG_LIMIT]}… (truncated)"
    return body


def is_model_image_unsupported_error(error: httpx.HTTPStatusError) -> bool:
    """Identify text-only model errors from supported provider runtimes."""
    if error.response.status_code not in (400, 422):
        return False
    try:
        payload = error.response.json()
        error_data = payload.get("error", payload) if isinstance(payload, dict) else payload
        message = str(error_data.get("message", "")) if isinstance(error_data, dict) else str(error_data)
    except Exception:
        try:
            message = error.response.text
        except Exception:
            return False
    normalized = " ".join(message.strip().lower().split())
    if normalized == MODEL_IMAGE_UNSUPPORTED_ERROR:
        return True
    mentions_image = "image" in normalized or "vision" in normalized
    unsupported = (
        "does not support" in normalized
        or "doesn't support" in normalized
        or "not supported" in normalized
        or "unsupported" in normalized
        or "no image support" in normalized
        or "no vision support" in normalized
    )
    return mentions_image and unsupported


def is_insufficient_memory_error(error: httpx.HTTPStatusError) -> bool:
    """Identify model-load and inference failures caused by insufficient memory."""
    try:
        payload = error.response.json()
        error_data = payload.get("error", payload) if isinstance(payload, dict) else payload
        message = str(error_data.get("message", error_data)) if isinstance(error_data, dict) else str(error_data)
    except Exception:
        try:
            message = error.response.text
        except Exception:
            return False
    return is_insufficient_memory_message(message)


def http_err_msg(e: httpx.HTTPStatusError, provider: str, language: str = "en") -> str:
    code = e.response.status_code
    message = ""
    try:
        data = e.response.json()
        error = data.get("error", {}) if isinstance(data, dict) else {}
        if isinstance(error, dict):
            message = str(error.get("message", ""))
        else:
            message = str(error)
    except Exception:
        pass
    key = {429: "rate_limit", 401: "invalid_key", 503: "unavailable"}.get(code, "api_error")
    return llm_message(key, language, provider=provider, status=code, detail=message)


def _provider_error(e: httpx.HTTPStatusError, log_entry: dict, provider: str, language: str) -> str:
    msg = http_err_msg(e, provider, language)
    log_entry["error"] = msg
    return f"❌ {msg}"


def openai_err(e: httpx.HTTPStatusError, log_entry: dict, language: str = "en") -> str:
    return _provider_error(e, log_entry, "OpenAI", language)


def gemini_err(e: httpx.HTTPStatusError, log_entry: dict, language: str = "en") -> str:
    return _provider_error(e, log_entry, "Gemini", language)


def claude_err(e: httpx.HTTPStatusError, log_entry: dict, language: str = "en") -> str:
    return _provider_error(e, log_entry, "Claude", language)
