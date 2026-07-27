"""
main.py – FastAPI 앱 생성 + 라우터 등록 + Lifespan
"""
import os
import locale
import signal
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import KOKORO_CACHE_READY, LOGS_DIR, SETUP_DONE
from config.models import DEFAULT_MODEL
from logger import setup_logging, get_logger
from services.mcp_config import ensure_mcp_config

APP_DIR = Path(__file__).parent

# 최초 설정에서 Kokoro 모델·음성 파일을 모두 받기 전에는 온라인 접근을
# 허용한다. 다운로드 완료 후에는 캐시만 사용하므로 오프라인에서도 동작한다.
if KOKORO_CACHE_READY.exists():
    os.environ.setdefault("HF_HUB_OFFLINE", "1")

SYSTEM_LANGUAGE_FALLBACK = "en"
SUPPORTED_SYSTEM_LANGUAGES = {"ko", "en", "ja", "zh", "th", "vi", "es", "fr"}
INITIAL_SETUP_MESSAGES = {
    "elasticsearch_not_installed": {
        "ko": "Elasticsearch는 아직 설치 전입니다 — 초기 설정에서 준비합니다.",
        "en": "Elasticsearch is not installed yet — it will be set up during initial configuration.",
        "ja": "Elasticsearch はまだインストールされていません。初期設定で準備します。",
        "zh": "Elasticsearch 尚未安装，将在初始设置中准备。",
        "th": "ยังไม่ได้ติดตั้ง Elasticsearch — ระบบจะเตรียมให้ระหว่างการตั้งค่าเริ่มต้น",
        "vi": "Elasticsearch chưa được cài đặt — sẽ được thiết lập trong quá trình cấu hình ban đầu.",
        "es": "Elasticsearch aún no está instalado; se configurará durante la configuración inicial.",
    },
    "rag_available_after_setup": {
        "ko": "초기 설정을 완료하면 RAG 기능을 사용할 수 있습니다.",
        "en": "Complete initial setup to enable RAG features.",
        "ja": "初期設定を完了すると、RAG 機能を利用できます。",
        "zh": "完成初始设置后即可使用 RAG 功能。",
        "th": "ทำการตั้งค่าเริ่มต้นให้เสร็จเพื่อใช้ฟีเจอร์ RAG",
        "vi": "Hoàn tất cấu hình ban đầu để sử dụng các tính năng RAG.",
        "es": "Complete la configuración inicial para habilitar las funciones RAG.",
    },
}


def get_system_language() -> str:
    """React i18n이 시작되기 전의 부팅 로그에 사용할 OS 언어 코드."""
    language_tag = (
        os.environ.get("VYACT_SYSTEM_LANGUAGE")
        or os.environ.get("LC_ALL")
        or os.environ.get("LC_MESSAGES")
        or os.environ.get("LANG")
        or locale.getlocale()[0]
        or ""
    )
    language = language_tag.split(".", 1)[0].split("_", 1)[0].lower()
    return language if language in SUPPORTED_SYSTEM_LANGUAGES else SYSTEM_LANGUAGE_FALLBACK


def initial_setup_message(message_key: str) -> str:
    language = get_system_language()
    return INITIAL_SETUP_MESSAGES[message_key].get(
        language,
        INITIAL_SETUP_MESSAGES[message_key][SYSTEM_LANGUAGE_FALLBACK],
    )

# ─────────────────────────────
# LOGGING  (앱 시작 시 1회 초기화)
# ─────────────────────────────
setup_logging()
logger = get_logger(__name__)


# ─────────────────────────────
# LIFESPAN
# ─────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # `python -m uvicorn main:app --reload` 같은 CLI 실행 경로에서는
    # uvicorn.run(log_config=None)이 적용되는 __main__ 블록을 안 타기 때문에,
    # uvicorn이 자체 기본 LOGGING_CONFIG로 dictConfig()를 호출해버려서
    # 모듈 import 시점에 설정해둔 uvicorn.access/error의 propagate=True,
    # 공용 핸들러 설정이 덮어써진다 (그 결과 access 로그가 우리 로그 파일/
    # 스트림에 전혀 안 찍힘). uvicorn이 자기 로깅 설정을 마친 뒤인 lifespan
    # 시작 시점에 한 번 더 강제 재적용해서, 실행 방식에 상관없이 항상
    # 우리 설정이 최종적으로 이기도록 한다.
    from logger import setup_logging as _reapply_logging
    import logger as _logger_module
    _logger_module._initialized = False  # 가드 무시하고 강제 재실행
    _reapply_logging()
    is_initial_setup = not SETUP_DONE.exists()

    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("Log directory: %s", LOGS_DIR)
    except Exception as e:
        logger.warning("Failed to create log directory: %s", e)

    # Playwright Chromium 설치 확인
    try:
        import subprocess, sys
        from playwright.sync_api import sync_playwright
        with sync_playwright() as p:
            p.chromium.executable_path  # 존재 여부만 확인
        logger.info("[playwright] Chromium ready")
    except Exception:
        logger.info("[playwright] Chromium not found — installing...")
        try:
            subprocess.run(
                [sys.executable, "-m", "playwright", "install", "chromium"],
                check=True, capture_output=True
            )
            logger.info("[playwright] Chromium installed")
        except Exception as e:
            logger.warning("[playwright] Chromium install failed: %s", e)

    es_available = False
    try:
        from agent import get_es
        es = get_es()
        info = await es.info()
        es_available = True
        logger.info("Elasticsearch connected: %s", info["version"]["number"])
        await es.close()
    except Exception as e:
        if is_initial_setup:
            logger.info(initial_setup_message("elasticsearch_not_installed"))
        else:
            logger.warning("Elasticsearch connection failed: %s", e)

    # Elasticsearch 연결 확인 뒤, 인덱스·언어 모델 초기화가 이어짐을 로딩 화면에 알린다.
    logger.info("[startup-status] models")

    # 리랭커 모델 로드 (백그라운드, 실패해도 서버 정상 동작)
    import asyncio as _asyncio
    from concurrent.futures import ThreadPoolExecutor as _TPE
    def _load():
        from reranker import load_reranker
        load_reranker()
    _asyncio.get_event_loop().run_in_executor(_TPE(max_workers=1), _load)

    if es_available:
        try:
            from agent import ensure_index, load_prompts_cache
            await ensure_index()
            from routers.skills import ensure_skills_index
            await ensure_skills_index()
            if SETUP_DONE.exists():
                await load_prompts_cache()
                logger.info("RAG index and prompt cache loaded")
        except Exception as e:
            logger.warning("Initialization failed: %s", e)

        try:
            from routers.deps import load_config_async, save_config_async
            from services.runtime_settings import apply_runtime_settings
            cfg = await load_config_async()
            if not cfg or not cfg.get("type"):
                cfg = {"type": "ollama", "model": DEFAULT_MODEL, "api_key": None, "config": {}}
                await save_config_async(cfg)
                logger.info("Default config saved to ES")
            apply_runtime_settings(cfg.get("runtime_settings"))
        except Exception as e:
            logger.warning("Config initialization failed: %s", e)
    else:
        if is_initial_setup:
            logger.info(initial_setup_message("rag_available_after_setup"))
        else:
            logger.warning("Elasticsearch unavailable — RAG features disabled")

    if SETUP_DONE.exists():
        try:
            from routers.deps import load_config_async
            from services.ollama_manager import load_model
            cfg = await load_config_async()
            if cfg.get("type", "ollama") == "ollama" and cfg.get("model"):
                model = cfg["model"]
                logger.info("Loading Ollama model: %s", model)
                ok = await load_model(model)
                if ok:
                    logger.info("Ollama model loaded: %s", model)
                    try:
                        from routers.deps import load_ui_language_async
                        from services.llm.warmup import schedule_ollama_prefix_warmup

                        ui_language = await load_ui_language_async() or ""
                        if schedule_ollama_prefix_warmup(model, ui_language):
                            logger.info("[llm_warmup] Scheduled after model load")
                    except Exception as e:
                        logger.debug("[llm_warmup] Scheduling skipped: %s", e)
        except Exception as e:
            logger.warning("Ollama model load failed: %s", e)

        try:
            from services.ollama_manager import load_embed_model
            await load_embed_model("bge-m3")
        except Exception as e:
            logger.warning("Embedding model load failed: %s", e)

    # Whisper 모델 사전 로드 (첫 STT 요청 지연 방지)
    try:
        from routers.stt import _get_model
        import asyncio
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _get_model)
        logger.info("Whisper model preloaded")
    except Exception as e:
        logger.warning("Whisper model preload failed: %s", e)

    # MCP 서버 연결 (filesystem 등) — 실패해도 앱은 정상 동작
    try:
        from services.mcp_client import mcp_manager
        from services.mcp_config import build_servers_config
        # 과거 설치본을 포함해 MCP 문서가 빠진 경우에만 기본 filesystem 항목을 만든다.
        await ensure_mcp_config()
        # 설치형 플러그인이 MCP 카탈로그와 내부 tool을 먼저 등록한다.
        try:
            from services.plugin_manager import load_installed_plugins
            await load_installed_plugins()
        except Exception as e:
            logger.warning("[plugins] Installed plugin loading failed: %s", e)
        try:
            from services.google_workspace import register_google_workspace_tools, get_granted_scopes
            granted = await get_granted_scopes()
            register_google_workspace_tools(mcp_manager, granted_scopes=granted)
        except Exception as e:
            if is_initial_setup:
                logger.debug("[mcp] Google Workspace tool skipped (initial setup): %s", e)
            else:
                logger.warning("[mcp] Google Workspace tool registration failed: %s", e)
        try:
            from services.code_tools import register_code_tools
            register_code_tools()
        except Exception as e:
            logger.warning("[mcp] Code analysis tool registration failed: %s", e)
        await mcp_manager.connect_all(await build_servers_config())
        # Google Workspace 인증 상태 확인
        try:
            await mcp_manager.refresh_google_auth()
        except Exception as e:
            logger.debug("[mcp] Google auth check failed: %s", e)
        # GitHub username 미리 조회 (tool 사용 시 지연 방지)
        try:
            from services.mcp_config import get_github_username
            await get_github_username()
        except Exception as e:
            logger.debug("[mcp] GitHub username prefetch failed: %s", e)
    except Exception as e:
        logger.warning("[mcp] Connection init failed: %s", e)

    # ── Kokoro TTS warm-up ──
    try:
        logger.info("[startup-status] tts")
        from routers.tts import KOKORO_DEFAULT_VOICES, KOKORO_LANG_MAP, _get_pipeline
        import asyncio
        loop = asyncio.get_running_loop()
        warmup_texts = {
            "a": "Hello",
            "b": "Hello",
            "e": "Hola",
            "f": "Bonjour",
            "h": "नमस्ते",
            "i": "Ciao",
            "j": "こんにちは",
            "p": "Olá",
            "z": "你好",
        }

        def _warmup():
            for lang_code in dict.fromkeys(KOKORO_LANG_MAP.values()):
                pipeline = _get_pipeline(lang_code)
                # 언어별 파이프라인 생성뿐 아니라 첫 추론까지 완료해 첫 재생 지연을 없앤다.
                for _, _, _ in pipeline(
                    warmup_texts[lang_code],
                    voice=KOKORO_DEFAULT_VOICES[lang_code],
                    speed=1.0,
                ):
                    break
        await loop.run_in_executor(None, _warmup)
        logger.info("[kokoro] all language TTS pipelines warmed up")
    except Exception as e:
        logger.info("[kokoro] TTS warm-up skipped: %s", e)

    # ── Whisper STT warm-up ──
    try:
        logger.info("[startup-status] stt")
        from routers.stt import _get_model
        import asyncio
        loop = asyncio.get_running_loop()
        await loop.run_in_executor(None, _get_model)
        logger.info("[whisper] STT warm-up done")
    except Exception as e:
        logger.info("[whisper] STT warm-up skipped: %s", e)

    if es_available and SETUP_DONE.exists():
        from services.notification_polling import start_notification_polling
        start_notification_polling()

    yield

    try:
        from services.notification_polling import stop_notification_polling
        await stop_notification_polling()
    except Exception as e:
        logger.warning("[notifications] Shutdown cleanup failed: %s", e)

    try:
        from services.plugin_manager import shutdown_loaded_plugins
        await shutdown_loaded_plugins()
    except Exception as e:
        logger.warning("[plugins] Shutdown cleanup failed: %s", e)

    try:
        from services.mcp_client import mcp_manager
        await mcp_manager.close()
    except Exception as e:
        logger.warning("[mcp] Shutdown cleanup failed: %s", e)

    try:
        from routers.deps import load_config_async
        from services.ollama_manager import unload_model
        cfg = await load_config_async()
        if cfg.get("type", "ollama") == "ollama" and cfg.get("model"):
            model = cfg["model"]
            logger.info("Unloading Ollama model: %s", model)
            await unload_model(model)
            logger.info("Ollama model unloaded: %s", model)
    except Exception as e:
        logger.warning("Ollama model unload failed: %s", e)


# ─────────────────────────────
# APP
# ─────────────────────────────
app = FastAPI(title="RAG Agent", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def prevent_static_asset_caching(request: Request, call_next):
    """앱 업데이트 뒤에도 항상 현재 번들의 CSS/JS를 사용한다."""
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
    return response


if (APP_DIR / "static").exists():
    app.mount("/assets", StaticFiles(directory=APP_DIR / "static" / "assets"), name="assets")


@app.get("/")
async def root():
    return FileResponse(APP_DIR / "static" / "index.html")


@app.get("/api/health")
async def health():
    """가벼운 헬스체크 — DB/ES 조회 없이 서버 생존만 확인"""
    return {"status": "ok"}


# ─────────────────────────────
# ROUTERS
# ─────────────────────────────
from routers.setup import router as setup_router
from routers.chat import router as chat_router
from routers.history import router as history_router
from routers.prompts import router as prompts_router
from routers.images import router as images_router
from routers.backup import router as backup_router
from routers.stt import router as stt_router
from routers.scripts import router as scripts_router
from routers.pdf import router as pdf_router
from routers.document import router as document_router
from routers.memo import router as memo_router
from routers.quicknote import router as quicknote_router
from routers.project import router as project_router
from routers.files import router as files_router
from routers.system import router as system_router
from routers.mcp import router as mcp_router
from routers.google_workspace_browser import router as google_workspace_browser_router
from routers.remember import router as remember_router
from routers.vocab import router as vocab_router
from routers.skills import router as skills_router
from routers.notifications import router as notifications_router
from routers.plugins import router as plugins_router

app.include_router(setup_router, prefix="/api")
app.include_router(chat_router, prefix="/api")
app.include_router(history_router, prefix="/api")
app.include_router(prompts_router, prefix="/api")
app.include_router(images_router, prefix="/api")
app.include_router(backup_router, prefix="/api")
app.include_router(stt_router, prefix="/api")
app.include_router(scripts_router, prefix="/api")
app.include_router(pdf_router, prefix="/api")
app.include_router(document_router, prefix="/api")
app.include_router(memo_router, prefix="/api")
app.include_router(quicknote_router, prefix="/api")
app.include_router(project_router, prefix="/api")
app.include_router(files_router, prefix="/api")
app.include_router(system_router, prefix="/api")
app.include_router(mcp_router, prefix="/api")
app.include_router(google_workspace_browser_router, prefix="/api")
app.include_router(remember_router, prefix="/api")
app.include_router(vocab_router, prefix="/api")
app.include_router(skills_router)
app.include_router(notifications_router, prefix="/api")
app.include_router(plugins_router, prefix="/api")
from services.plugin_manager import plugin_api_dispatcher
app.mount("/api/plugin-api", plugin_api_dispatcher)

from routers.tts import router as tts_router
app.include_router(tts_router, prefix="/api")


# ─────────────────────────────
# SHUTDOWN ENDPOINT
# ─────────────────────────────
@app.post("/api/shutdown")
async def shutdown():
    """Electron 앱 종료 시 호출 - ollama 언로드 후 서버 프로세스 종료"""
    try:
        from routers.deps import load_config_async
        from services.ollama_manager import unload_model
        cfg = await load_config_async()
        if cfg.get("type", "ollama") == "ollama" and cfg.get("model"):
            model = cfg["model"]
            logger.info("[shutdown] Unloading Ollama model: %s", model)
            await unload_model(model)
            logger.info("[shutdown] Ollama model unloaded: %s", model)
    except Exception as e:
        logger.error("[shutdown] Unload failed: %s", e)
    finally:
        os.kill(os.getpid(), signal.SIGTERM)
    return {"ok": True}


# ─────────────────────────────
if __name__ == "__main__":
    uvicorn.run(
        "main:app",
        host="127.0.0.1",
        port=8000,
        log_config=None,
        log_level="info",
    )
