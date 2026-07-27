"""
routers/system.py – 시스템 액션 (앱 실행 — macOS / Windows)
POST /api/system/open-app      → 앱 실행 (이름 직접 실행, 사전 스캔 불필요)
"""
import sys
import subprocess
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from routers.deps import load_ui_language_async, save_ui_language_async
from logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

SUPPORTED_UI_LANGUAGES = {"ko", "en", "ja", "zh", "th", "vi", "es", "fr"}

IS_MAC = sys.platform == "darwin"
IS_WIN = sys.platform == "win32"


class OpenAppRequest(BaseModel):
    app_name: str
    url: str = ""


class UiLanguageRequest(BaseModel):
    language: str


@router.get("/settings/language")
async def get_ui_language():
    """ES에 저장된 UI 언어를 반환한다. 설정이 없으면 클라이언트가 시스템 언어를 저장한다."""
    language = await load_ui_language_async()
    return {"language": language if language in SUPPORTED_UI_LANGUAGES else None}


@router.put("/settings/language")
async def update_ui_language(req: UiLanguageRequest):
    language = req.language.lower().split("-", 1)[0]
    if language not in SUPPORTED_UI_LANGUAGES:
        raise HTTPException(400, "지원하지 않는 언어입니다.")
    saved = await save_ui_language_async(language)
    return {"language": language, "saved": saved}


@router.post("/system/open-app")
async def open_app(req: OpenAppRequest):
    """앱 실행. 설치 목록 캐시 없이 OS 런처에 이름을 직접 넘긴다."""
    app_name = req.app_name.strip()
    if not app_name:
        raise HTTPException(400, "앱 이름이 필요합니다")

    try:
        if IS_MAC:
            cmd = ["open", "-a", app_name]
            if req.url:
                cmd.append(req.url)
            subprocess.Popen(cmd)
        elif IS_WIN:
            if req.url:
                subprocess.Popen(["cmd", "/c", "start", "", app_name, req.url], shell=False)
            else:
                subprocess.Popen(["cmd", "/c", "start", "", app_name], shell=False)
        else:
            subprocess.Popen(["xdg-open", app_name])

        logger.info("[system] 앱 실행: %s", app_name)
        return {"ok": True, "app": app_name}
    except Exception as e:
        logger.error("[system] 앱 실행 실패: %s", e)
        raise HTTPException(500, f"앱 실행 실패: {e}")
