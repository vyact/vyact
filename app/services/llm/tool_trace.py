"""Request-local, opt-in traces of tool execution and outgoing model context."""
import json
import re
from contextvars import ContextVar

from .tools import tool_result_failed

tool_trace: ContextVar[dict | None] = ContextVar("llm_tool_trace", default=None)
_SECRET_KEYS = {"api_key", "apikey", "access_token", "refresh_token", "token",
                "authorization", "password", "secret", "client_secret"}
_SECRET_TEXT = re.compile(
    r'(?i)(\b(?:api[_-]?key|access_token|refresh_token|authorization|password|client_secret|secret)\b["\x27]?\s*[:=]\s*["\x27]?)([^\s"\x27&,}]+)'
)
_BEARER = re.compile(r"(?i)\bBearer\s+[A-Za-z0-9._~+/=-]+")


def redact(value):
    if isinstance(value, dict):
        return {key: "[REDACTED]" if key.lower().replace("-", "_") in _SECRET_KEYS
                else redact(item) for key, item in value.items()}
    if isinstance(value, list):
        return [redact(item) for item in value]
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
        except (ValueError, TypeError):
            return _SECRET_TEXT.sub(r"\1[REDACTED]", _BEARER.sub("Bearer [REDACTED]", value))
        if isinstance(parsed, (dict, list)):
            return json.dumps(redact(parsed), ensure_ascii=False)
    return value


def record_tool_event(event: dict):
    trace = tool_trace.get()
    if trace is None or event.get("phase") not in {"start", "end", "approval_rejected", "stopped"}:
        return
    entry = {key: event[key] for key in ("phase", "name", "args", "result", "reason") if key in event}
    if "result" in entry:
        entry["status"] = ("rejected" if event["phase"] == "approval_rejected"
                           else "error" if tool_result_failed(str(entry["result"])) else "success")
    trace["executions"].append(redact(entry))


def record_tool_context(provider: str, body: dict):
    trace = tool_trace.get()
    if trace is None:
        return
    messages = []
    for message in body.get("messages", body.get("contents", [])):
        if message.get("role") == "tool" or message.get("tool_calls"):
            messages.append(message)
            continue
        blocks = message.get("content", message.get("parts"))
        if isinstance(blocks, list):
            selected = [block for block in blocks if isinstance(block, dict) and (
                block.get("type") in {"tool_use", "tool_result"}
                or "functionCall" in block or "functionResponse" in block)]
            if selected:
                messages.append({"role": message.get("role"),
                                 "parts" if "parts" in message else "content": selected})
    if messages:
        trace["model_requests"].append({"provider": provider, "messages": redact(messages)})
