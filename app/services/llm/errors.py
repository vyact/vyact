"""
services/llm/errors.py — provider HTTP 에러 메시지 변환
"""
import httpx


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
