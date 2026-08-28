"""
services/llm/errors.py — provider HTTP 에러 메시지 변환
"""
import httpx


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
    normalized = " ".join(message.strip().lower().split())
    return any(marker in normalized for marker in INSUFFICIENT_MEMORY_ERROR_MARKERS)


def http_err_msg(e: httpx.HTTPStatusError, provider: str) -> str:
    try:
        data = e.response.json()
        code = e.response.status_code
        msg = data.get("error", {}).get("message", "")
        if code == 429:
            return f"{provider} API 사용량 한도를 초과했습니다."
        if code == 401:
            return f"{provider} API 키가 유효하지 않습니다."
        if code == 503:
            return f"{provider} API가 일시적으로 사용 불가능합니다."
        return f"{provider} API 오류: {msg}"
    except Exception:
        return f"{provider} API 오류 (코드: {e.response.status_code})"


def openai_err(e: httpx.HTTPStatusError, log_entry: dict) -> str:
    msg = http_err_msg(e, "OpenAI")
    log_entry["error"] = msg
    return f"❌ {msg}"


def gemini_err(e: httpx.HTTPStatusError, log_entry: dict) -> str:
    try:
        data = e.response.json()
        code = data.get("error", {}).get("code")
        raw = data.get("error", {}).get("message", "")
        if code == 503:
            msg = "Gemini API가 현재 과부하 상태입니다."
        elif code == 429:
            msg = "API 사용량 한도를 초과했습니다."
        elif code == 401:
            msg = "API 키가 유효하지 않습니다."
        else:
            msg = f"Gemini API 오류: {raw}"
    except Exception:
        msg = f"Gemini API 오류 (코드: {e.response.status_code})"
    log_entry["error"] = msg
    return f"❌ {msg}"


def claude_err(e: httpx.HTTPStatusError, log_entry: dict) -> str:
    msg = http_err_msg(e, "Claude")
    log_entry["error"] = msg
    return f"❌ {msg}"
