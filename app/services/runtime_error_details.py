"""Bounded local-runtime log details for startup failures."""
from pathlib import Path

RUNTIME_ERROR_LOG_TAIL_BYTES = 32 * 1024
RUNTIME_ERROR_LOG_TAIL_LINES = 24
RUNTIME_FAILURE_MESSAGE_MAX_LENGTH = 500
OUT_OF_MEMORY_MARKERS = (
    "out of memory",
    "insufficient memory",
    "allocation failed",
    "failed to allocate",
    "memory allocation",
    "not enough memory",
)


class RuntimeStartupError(RuntimeError):
    def __init__(self, message: str, diagnostic: str = ""):
        super().__init__(message)
        self.diagnostic = diagnostic


def runtime_startup_error(fallback: str, log_path: Path) -> RuntimeStartupError:
    """Include a bounded log tail so callers can classify startup failures."""
    try:
        with log_path.open("rb") as log_file:
            log_file.seek(0, 2)
            log_file.seek(max(0, log_file.tell() - RUNTIME_ERROR_LOG_TAIL_BYTES))
            lines = log_file.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        lines = []
    detail = "\n".join(lines[-RUNTIME_ERROR_LOG_TAIL_LINES:]).strip()
    return RuntimeStartupError(fallback, detail)


def classify_runtime_load_failure(error: Exception) -> tuple[str, str]:
    """Return a stable failure code and bounded useful detail from a startup error."""
    diagnostic = str(getattr(error, "diagnostic", "") or "").strip()
    fallback_message = str(error).strip()
    combined = "\n".join(part for part in (fallback_message, diagnostic) if part).lower()
    failure_code = (
        "out_of_memory"
        if any(marker in combined for marker in OUT_OF_MEMORY_MARKERS)
        else "load_failed"
    )
    detail_lines = [line.strip() for line in diagnostic.splitlines() if line.strip()]
    message = detail_lines[-1] if detail_lines else fallback_message or "Runtime load failed"
    return failure_code, message[:RUNTIME_FAILURE_MESSAGE_MAX_LENGTH]
