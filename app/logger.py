"""
logger.py – 앱 전역 로깅 설정 및 logger 팩토리

사용법:
    from logger import get_logger
    logger = get_logger(__name__)

로그 파일 (일별 로테이션, ~/.ragagent/logs/):
    app_YYYYMMDD.log   – 앱 전반 (INFO+)
    llm_YYYYMMDD.log   – LLM 요청/응답
    event_YYYYMMDD.log – 이벤트 감사 로그
"""
import json
import logging
import os
import re
import secrets
import sys
import unicodedata
from contextvars import ContextVar
from pathlib import Path

_initialized = False


class ToolLogSettings:
    """Runtime switches shared by every app-log handler."""

    enabled = True

    @classmethod
    def set_enabled(cls, enabled: bool) -> None:
        cls.enabled = bool(enabled)


class DebugLogSettings:
    """Opt-in diagnostics shared by application debug instrumentation.

    Keep this disabled in normal operation because browser inspection results may
    contain page text. It can be toggled before startup with
    ``VYACT_DEBUG_LOGGING=1`` or at runtime in tests/development.
    """

    enabled = os.getenv("VYACT_DEBUG_LOGGING", "").strip().lower() in {
        "1", "true", "yes", "on",
    }
    MAX_PAYLOAD_CHARS = 30_000
    _SENSITIVE_ARGUMENT_KEYS = {
        "text", "password", "token", "api_key", "authorization", "secret",
    }
    _trace_id: ContextVar[str] = ContextVar("debug_trace_id", default="")

    @classmethod
    def set_enabled(cls, enabled: bool) -> None:
        cls.enabled = bool(enabled)

    @classmethod
    def redact_arguments(cls, arguments: object) -> object:
        if isinstance(arguments, list):
            return [cls.redact_arguments(value) for value in arguments]
        if not isinstance(arguments, dict):
            return arguments
        return {
            key: "[REDACTED]" if key.lower() in cls._SENSITIVE_ARGUMENT_KEYS
            else cls.redact_arguments(value)
            for key, value in arguments.items()
        }

    @classmethod
    def result_payload(cls, result: object) -> object:
        if not isinstance(result, str):
            return result
        try:
            return json.loads(result)
        except (json.JSONDecodeError, TypeError):
            return result

    @classmethod
    def ensure_trace_id(cls) -> str:
        trace_id = cls._trace_id.get()
        if not trace_id:
            trace_id = secrets.token_hex(4)
            cls._trace_id.set(trace_id)
        return trace_id

    @classmethod
    def summarize_result(cls, result: object) -> dict:
        payload = cls.result_payload(result)
        if isinstance(payload, list):
            return {
                "result_type": "list",
                "item_count": len(payload),
                "items": payload[:20],
            }
        if not isinstance(payload, dict):
            text = str(payload or "")
            return {"result_type": "text", "length": len(text), "preview": text[:500]}
        summary = {
            key: payload.get(key)
            for key in ("ok", "error", "url", "title", "open", "loading", "element")
            if payload.get(key) is not None
        }
        text = payload.get("text")
        if isinstance(text, str):
            summary.update({"text_length": len(text), "text_preview": text[:500]})
        pages = payload.get("pages")
        if isinstance(pages, list):
            summary["page_count"] = len(pages)
            summary["pages"] = [
                {
                    "url": page.get("url"),
                    "title": page.get("title"),
                    "text_length": len(str(page.get("text") or "")),
                    "error": page.get("error"),
                }
                for page in pages if isinstance(page, dict)
            ]
        return summary

    @classmethod
    def log(cls, event: str, **payload: object) -> None:
        if not cls.enabled:
            return
        serialized = json.dumps(
            {"trace_id": cls.ensure_trace_id(), **payload},
            ensure_ascii=False,
            default=str,
        )
        if len(serialized) > cls.MAX_PAYLOAD_CHARS:
            serialized = serialized[:cls.MAX_PAYLOAD_CHARS] + "…[truncated]"
        debug_logger = logging.getLogger("debug")
        # Keep the root logger at INFO to avoid noisy third-party diagnostics.
        # An explicit child level still lets these opt-in records reach the
        # existing root handlers with the correct DEBUG severity label.
        debug_logger.setLevel(logging.DEBUG)
        debug_logger.debug("[debug] event=%s data=%s", event, serialized)


class _UnicodeNormalizationFilter(logging.Filter):
    """Normalize log messages so macOS filenames render as complete Hangul."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        record.msg = unicodedata.normalize("NFC", message)
        record.args = ()
        return True


class _SensitiveLogDataFilter(logging.Filter):
    """Redact credentials that third-party HTTP loggers may embed in URLs."""

    _QUERY_SECRET_PATTERN = re.compile(
        r"(?i)([?&](?:access_token|api_key|key|password|refresh_token|secret|token)=)[^&\s\"']+"
    )
    _BEARER_PATTERN = re.compile(r"(?i)(authorization[=:]\s*bearer\s+)[^\s\"']+")

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        message = self._QUERY_SECRET_PATTERN.sub(r"\1[REDACTED]", message)
        message = self._BEARER_PATTERN.sub(r"\1[REDACTED]", message)
        record.msg = message
        record.args = ()
        return True


class _PdfMinerFontBBoxFilter(logging.Filter):
    """Hide a harmless warning emitted for PDFs with an omitted FontBBox."""

    MESSAGE_PREFIX = "Could not get FontBBox from font descriptor because None"

    def filter(self, record: logging.LogRecord) -> bool:
        return not record.getMessage().startswith(self.MESSAGE_PREFIX)


class _ToolLoggingFilter(logging.Filter):
    """Suppress ordinary tool orchestration records when Tool logging is off."""

    def filter(self, record: logging.LogRecord) -> bool:
        message = record.getMessage()
        is_tool_log = (
            message.startswith("[tool_calls]")
            or message.startswith("[tool_pass]")
            or (message.startswith("[llm_call]") and "kind=tool_judgment" in message)
        )
        return not is_tool_log or ToolLogSettings.enabled


def setup_logging() -> None:
    """루트 로거 초기화. main.py 최상단에서 1회만 호출."""
    global _initialized
    if _initialized:
        return
    _initialized = True

    from config import get_log_file
    log_file = get_log_file("app")

    fmt = logging.Formatter(
        "[%(asctime)s] %(levelname)s %(name)s: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )
    fmt_uvi = logging.Formatter(
        "[%(asctime)s] %(levelname)s uvicorn: %(message)s",
        datefmt="%Y-%m-%dT%H:%M:%S",
    )

    root = logging.getLogger()
    root.setLevel(logging.INFO)

    target_log_path = Path(log_file).resolve()
    has_target_file_handler = any(
        isinstance(handler, logging.FileHandler)
        and Path(handler.baseFilename).resolve() == target_log_path
        for handler in root.handlers
    )
    if not has_target_file_handler:
        fh = logging.FileHandler(log_file, encoding="utf-8")
        fh.setFormatter(fmt)
        fh.addFilter(_ToolLoggingFilter())
        fh.addFilter(_SensitiveLogDataFilter())
        fh.addFilter(_UnicodeNormalizationFilter())
        root.addHandler(fh)

    if not any(
            isinstance(h, logging.StreamHandler) and not isinstance(h, logging.FileHandler)
            for h in root.handlers
    ):
        sh = logging.StreamHandler(sys.stdout)
        sh.setFormatter(fmt)
        sh.addFilter(_ToolLoggingFilter())
        sh.addFilter(_SensitiveLogDataFilter())
        sh.addFilter(_UnicodeNormalizationFilter())
        root.addHandler(sh)

    # uvicorn 로그 통합
    for name in ("uvicorn", "uvicorn.access", "uvicorn.error", "fastapi"):
        lg = logging.getLogger(name)
        lg.handlers = []
        lg.propagate = True

    # 헬스체크·알림 폴링 요청은 access 로그가 너무 많이 쌓이므로 제외
    class _HealthCheckFilter(logging.Filter):
        _NOISY_PATHS = ("/api/health", "/api/notifications")

        def filter(self, record: logging.LogRecord) -> bool:
            msg = record.getMessage()
            return not any(p in msg for p in self._NOISY_PATHS)

    logging.getLogger("uvicorn.access").addFilter(_HealthCheckFilter())

    # Google Docs/Skia PDF 일부는 선택 항목인 FontBBox를 생략한다. pdfminer는
    # 텍스트를 정상 추출하면서도 같은 무해한 경고를 폰트마다 반복하므로 이
    # 메시지만 제외하고, pdfminer의 다른 경고는 그대로 유지한다.
    logging.getLogger("pdfminer.pdffont").addFilter(_PdfMinerFontBBoxFilter())

    uve = logging.getLogger("uvicorn.error")
    uve.propagate = False
    for h, fmt_ in [
        (logging.FileHandler(log_file, encoding="utf-8"), fmt_uvi),
        (logging.StreamHandler(sys.stdout), fmt_uvi),
    ]:
        h.setFormatter(fmt_)
        h.addFilter(_ToolLoggingFilter())
        h.addFilter(_SensitiveLogDataFilter())
        h.addFilter(_UnicodeNormalizationFilter())
        uve.addHandler(h)

    # elasticsearch 노이즈 억제
    for name in (
            "elastic_transport",
            "elastic_transport.transport",
            "elastic_transport.node_pool",
    ):
        logging.getLogger(name).setLevel(logging.ERROR)


def get_logger(name: str) -> logging.Logger:
    """모듈별 logger 반환."""
    return logging.getLogger(name)
