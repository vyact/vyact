"""Bounded local-runtime log details for startup failures."""
from pathlib import Path

RUNTIME_ERROR_LOG_TAIL_BYTES = 32 * 1024
RUNTIME_ERROR_LOG_TAIL_LINES = 24


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
