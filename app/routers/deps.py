"""
routers/deps.py – 라우터 공통 유틸
"""
import json
from datetime import datetime, timezone
from pathlib import Path

from config import INSTALL_DIR, SETUP_DONE, get_log_file
from logger import get_logger

logger = get_logger(__name__)

APP_DIR = Path(__file__).parent.parent
IMAGES_DIR = INSTALL_DIR / "uploads" / "images"
IMAGES_DIR.mkdir(parents=True, exist_ok=True)
LEGACY_GOOGLE_API_KEY_FIELD = "google_api_key"


def sse(msg: str, type: str = "info", progress: int = None,
        i18n_key: str = None, i18n_params: dict = None) -> str:
    data: dict = {"message": msg, "type": type}
    if progress is not None:
        data["progress"] = progress
    if i18n_key:
        data["i18nKey"] = i18n_key
    if i18n_params:
        data["i18nParams"] = i18n_params
    return f"data: {json.dumps(data, ensure_ascii=False)}\n\n"


async def load_config_async() -> dict:
    """ES system_settings에서 config 로드."""
    try:
        from services.db import get_es, SETTINGS_INDEX
        es = get_es()
        try:
            res = await es.get(index=SETTINGS_INDEX, id="config", ignore=[404])
            if res.get("found"):
                config = res["_source"].get("value", {})
                if not isinstance(config, dict):
                    return {}
                if LEGACY_GOOGLE_API_KEY_FIELD in config:
                    config = {
                        key: value
                        for key, value in config.items()
                        if key != LEGACY_GOOGLE_API_KEY_FIELD
                    }
                    await es.index(
                        index=SETTINGS_INDEX,
                        id="config",
                        document={"key": "config", "value": config},
                        refresh=True,
                    )
                    logger.info("[config] removed legacy global Google API key")
                return config
        finally:
            await es.close()
    except Exception as e:
        from config import SETUP_DONE
        if SETUP_DONE.exists():
            logger.warning("[config] ES load failed: %s", e)
        else:
            logger.debug("[config] ES not available (initial setup)")
    return {"type": "vyact", "model": "", "vyact_config": {}}


async def save_config_async(cfg: dict):
    """ES system_settings에 config 저장."""
    sanitized_config = {
        key: value
        for key, value in cfg.items()
        if key != LEGACY_GOOGLE_API_KEY_FIELD
    }
    try:
        from services.db import get_es, SETTINGS_INDEX
        es = get_es()
        try:
            await es.index(
                index=SETTINGS_INDEX,
                id="config",
                document={"key": "config", "value": sanitized_config},
                refresh=True,
            )
        finally:
            await es.close()
    except Exception as e:
        logger.warning("[config] ES save failed: %s", e)


async def load_ui_language_async() -> str | None:
    """ES system_settings의 독립 언어 설정을 읽는다."""
    # 초기 설치 화면에서는 Elasticsearch가 아직 존재하지 않는다.
    # 연결을 시도하지 않아 불필요한 오류 로그와 지연을 막는다.
    if not SETUP_DONE.exists():
        return None
    try:
        from services.db import get_es, SETTINGS_INDEX
        es = get_es()
        try:
            result = await es.get(index=SETTINGS_INDEX, id="ui_language", ignore=[404])
            if result.get("found"):
                language = result["_source"].get("value")
                return language if isinstance(language, str) else None
        finally:
            await es.close()
    except Exception as e:
        logger.warning("[ui_language] ES load failed: %s", e)
    return None


async def save_ui_language_async(language: str) -> bool:
    """ES system_settings에 UI 언어를 독립 문서로 저장한다."""
    # 설치 완료 전에는 클라이언트가 localStorage에 언어를 보관하고,
    # 설치 완료 이벤트를 받은 직후 Elasticsearch로 동기화한다.
    if not SETUP_DONE.exists():
        return False
    try:
        from services.db import get_es, SETTINGS_INDEX
        es = get_es()
        try:
            await es.index(
                index=SETTINGS_INDEX,
                id="ui_language",
                document={"key": "ui_language", "value": language},
                refresh=True,
            )
            return True
        finally:
            await es.close()
    except Exception as e:
        logger.warning("[ui_language] ES save failed: %s", e)
        return False


def write_log(event: str, extra: dict | None = None):
    try:
        entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "event": event,
            **(extra or {}),
        }
        with open(get_log_file("event"), "a", encoding="utf-8") as f:
            f.write(json.dumps(entry, ensure_ascii=False) + "\n")
    except Exception as e:
        logger.warning("Log write failed: %s", e)
