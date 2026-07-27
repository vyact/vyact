"""
Config Package
"""
from datetime import datetime
from pathlib import Path

from .models import DEFAULT_MODEL, RECOMMENDED_MODELS, IMAGE_MODEL_IDS

# ─────────────────────────────
# APP
# ─────────────────────────────
APP_NAME = "vyact"  # 앱 이름 — 디렉토리명 등에 사용

# ─────────────────────────────
# PATH
# ─────────────────────────────
INSTALL_DIR = Path.home() / f".{APP_NAME}"
VENV_DIR = INSTALL_DIR / "venv"
SETUP_DONE = INSTALL_DIR / ".setup_done"
# Kokoro 모델과 모든 음성 파일의 다운로드가 끝났음을 나타낸다. 이 파일이
# 있을 때만 앱 실행을 Hugging Face 캐시 전용 모드로 제한한다.
KOKORO_CACHE_READY = INSTALL_DIR / ".kokoro_cache_ready"

# ─────────────────────────────
# LOGS
# ─────────────────────────────
LOGS_DIR = INSTALL_DIR / "logs"
LOGS_DIR.mkdir(parents=True, exist_ok=True)


def _today() -> str:
    return datetime.now().strftime("%Y%m%d")


def get_log_file(name: str) -> Path:
    """name: 'llm' | 'event' | 'app'  →  ~/.vyact/logs/{name}_YYYYMMDD.log"""
    return LOGS_DIR / f"{name}_{_today()}.log"


def cleanup_old_logs(keep_days: int = 20) -> None:
    """날짜 suffix 기준으로 오래된 로그 파일 삭제 (기본 20일 보관)"""
    import re
    pattern = re.compile(r'_(20\d{6})\.log$')
    date_files: dict[str, list[Path]] = {}

    for f in LOGS_DIR.glob("*.log"):
        m = pattern.search(f.name)
        if m:
            date_files.setdefault(m.group(1), []).append(f)

    sorted_dates = sorted(date_files.keys(), reverse=True)  # 최신순
    for old_date in sorted_dates[keep_days:]:
        for f in date_files[old_date]:
            try:
                f.unlink()
            except Exception:
                pass


# 앱 시작 시 오래된 로그 정리
cleanup_old_logs()

# 하위 호환성 — 기존 LOG_FILE 참조를 event 로그로 연결
LOG_FILE = get_log_file("event")

__all__ = [
    'APP_NAME',
    'DEFAULT_MODEL',
    'RECOMMENDED_MODELS',
    'IMAGE_MODEL_IDS',
    'INSTALL_DIR',
    'VENV_DIR',
    'SETUP_DONE',
    'KOKORO_CACHE_READY',
    'LOGS_DIR',
    'LOG_FILE',
    'get_log_file',
]
