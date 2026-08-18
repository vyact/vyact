"""
services/llm/errors.py — provider HTTP 에러 메시지 변환
"""
import httpx


HTTP_ERROR_BODY_LOG_LIMIT = 4_000
OLLAMA_IMAGE_UNSUPPORTED_ERROR = "this model does not support image input"


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


def is_ollama_image_unsupported_error(error: httpx.HTTPStatusError) -> bool:
    """Identify Ollama's stable 400 response for a text-only model."""
    if error.response.status_code != 400:
        return False
    try:
        message = str(error.response.json().get("error", "")).strip().lower()
    except Exception:
        return False
    return message == OLLAMA_IMAGE_UNSUPPORTED_ERROR


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
