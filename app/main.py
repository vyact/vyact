"""
main.py – FastAPI 앱 생성 + 라우터 등록 + Lifespan
"""
import asyncio
import os
import locale
import signal
import warnings
from concurrent.futures import ThreadPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from config import KOKORO_CACHE_READY, LOGS_DIR, SETUP_DONE
from logger import setup_logging, get_logger
from services.external_data.scheduler import (
    start_external_data_scheduler,
    stop_external_data_scheduler,
)
from services.mcp_config import ensure_mcp_config
from services.runtime_settings import apply_runtime_settings
from routers.browser_extension import router as browser_extension_router

APP_DIR = Path(__file__).parent

# 아래 경고는 현재 사용하는 외부 라이브러리 내부 구현에서 발생하며 앱이
# 제어할 수 없다. 메시지와 발생 모듈을 함께 제한해 애플리케이션 경고는
# 그대로 노출한다.
warnings.filterwarnings(
    "ignore",
    message=r"dropout option adds dropout.*num_layers greater than 1.*",
    category=UserWarning,
    module=r"torch\.nn\.modules\.rnn",
)
warnings.filterwarnings(
    "ignore",
    message=r"`torch\.nn\.utils\.weight_norm` is deprecated.*",
    category=FutureWarning,
    module=r"torch\.nn\.utils\.weight_norm",
)
warnings.filterwarnings(
    "ignore",
    message=r"invalid escape sequence.*",
    category=SyntaxWarning,
)
warnings.filterwarnings(
    "ignore",
    message=r"pkg_resources is deprecated as an API.*",
    category=UserWarning,
    module=r"jieba\._compat",
)

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
        "fr": "Elasticsearch n’est pas encore installé ; il sera préparé lors de la configuration initiale.",
    },
    "rag_available_after_setup": {
        "ko": "초기 설정을 완료하면 RAG 기능을 사용할 수 있습니다.",
        "en": "Complete initial setup to enable RAG features.",
        "ja": "初期設定を完了すると、RAG 機能を利用できます。",
        "zh": "完成初始设置后即可使用 RAG 功能。",
        "th": "ทำการตั้งค่าเริ่มต้นให้เสร็จเพื่อใช้ฟีเจอร์ RAG",
        "vi": "Hoàn tất cấu hình ban đầu để sử dụng các tính năng RAG.",
        "es": "Complete la configuración inicial para habilitar las funciones RAG.",
        "fr": "Terminez la configuration initiale pour activer les fonctionnalités RAG.",
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


async def warmup_kokoro_tts() -> bool:
    """Kokoro와 언어별 음성 파이프라인을 미리 준비한다."""
    try:
        logger.info("[startup-status] tts")
        from routers.tts import (
            KOKORO_DEFAULT_VOICES,
            KOKORO_LANG_MAP,
            _get_pipeline,
            _unidic_installer,
        )
        loop = asyncio.get_running_loop()
        warmup_texts = {
            "a": "Hello", "b": "Hello", "e": "Hola", "f": "Bonjour",
            "h": "नमस्ते", "i": "Ciao", "j": "こんにちは", "p": "Olá", "z": "你好",
        }
        language_codes = list(dict.fromkeys(KOKORO_LANG_MAP.values()))
        if not await _unidic_installer().is_unidic_dictionary_installed():
            language_codes.remove("j")
            logger.info("[kokoro] Japanese TTS warm-up deferred until UniDic is installed")

        def _warmup():
            for lang_code in language_codes:
                pipeline = _get_pipeline(lang_code)
                for _, _, _ in pipeline(
                    warmup_texts[lang_code],
                    voice=KOKORO_DEFAULT_VOICES[lang_code],
                    speed=1.0,
                ):
                    break

        await loop.run_in_executor(None, _warmup)
        logger.info("[kokoro] all language TTS pipelines warmed up")
        return True
    except Exception as error:
        logger.info("[kokoro] TTS warm-up skipped: %s", error)
        return False


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

    try:
        from services.vyact_runtime import initialize_downloaded_models_cache
        installed_vyact_models = initialize_downloaded_models_cache()
        logger.info("[vyact] Cached %d downloaded model(s)", len(installed_vyact_models))
    except Exception as e:
        logger.warning("[vyact] Failed to initialize downloaded model cache: %s", e)

    # 최초 설정에서는 Provider 선택 후 설치 진행 화면에서 준비한다.
    if not is_initial_setup:
        try:
            from playwright.async_api import async_playwright
            async with async_playwright() as p:
                chromium_path = Path(p.chromium.executable_path)
                if not chromium_path.is_file():
                    raise FileNotFoundError(chromium_path)
            logger.info("[playwright] Chromium ready")
        except Exception as e:
            logger.warning("[playwright] Chromium unavailable: %s", e)

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

    # 최초 설정 전에는 모델 준비를 Provider 선택 후 설치 화면에서 수행한다.
    if not is_initial_setup:
        logger.info("[startup-status] models")

    if es_available:
        try:
            from agent import ensure_index, load_prompts_cache
            await ensure_index()
            from services.language_learning_profile import ensure_language_learning_profile_index
            await ensure_language_learning_profile_index()
            from routers.skills import ensure_skills_index
            await ensure_skills_index()
            if SETUP_DONE.exists():
                await load_prompts_cache()
                logger.info("RAG index and prompt cache loaded")
        except Exception as e:
            logger.warning("Initialization failed: %s", e)

        try:
            from routers.deps import load_config_async, save_config_async
            from logger import DebugLogSettings, ToolLogSettings
            cfg = await load_config_async()
            if not cfg or not cfg.get("type"):
                cfg = {"type": "vyact", "model": "", "vyact_config": {}, "config": {}}
                await save_config_async(cfg)
                logger.info("Default config saved to ES")
            apply_runtime_settings(cfg.get("runtime_settings"))
            ToolLogSettings.set_enabled(cfg.get("tool_logging", True))
            DebugLogSettings.set_enabled(
                cfg.get("debug_logging", cfg.get("tool_debug_logging", False))
            )
        except Exception as e:
            logger.warning("Config initialization failed: %s", e)
    else:
        if is_initial_setup:
            logger.info(initial_setup_message("rag_available_after_setup"))
        else:
            logger.warning("Elasticsearch unavailable — RAG features disabled")

    vyact_warmup_model_id = ""
    vyact_warmup_language = ""
    if SETUP_DONE.exists():
        try:
            from routers.deps import load_config_async, save_config_async
            cfg = await load_config_async()
            if cfg.get("type") == "vyact" and cfg.get("vyact_config", {}).get("model_path"):
                from services.vyact_runtime import start_configured_runtime
                vyact_config = cfg["vyact_config"]
                logger.info("Loading Vyact local model: %s", vyact_config["model_path"])
                model_id = await asyncio.to_thread(
                    start_configured_runtime, vyact_config, cfg.get("debug_logging", False),
                )
                cfg["model"] = model_id
                cfg["vyact_config"]["model"] = model_id
                cfg.setdefault("runtime_settings", {})["llm_num_ctx"] = cfg["vyact_config"]["context_size"]
                apply_runtime_settings(cfg["runtime_settings"])
                await save_config_async(cfg)
                try:
                    from routers.deps import load_ui_language_async
                    vyact_warmup_model_id = model_id
                    vyact_warmup_language = await load_ui_language_async() or ""
                except Exception as error:
                    logger.debug("[llm_warmup] Vyact warm-up preparation skipped: %s", error)
        except Exception as e:
            logger.warning("Local model load failed: %s", e)

    # MLX와 reranker는 둘 다 transformers 계열을 import한다. 앱 시작 시
    # 별도 스레드에서 동시에 초기화하면 MLX의 lazy import가 일시적으로
    # 실패할 수 있으므로, 선택된 로컬 LLM을 먼저 준비한 후 로드한다.
    if not is_initial_setup:
        def _load_reranker() -> None:
            from reranker import load_reranker
            load_reranker()

        asyncio.get_running_loop().run_in_executor(
            ThreadPoolExecutor(max_workers=1), _load_reranker,
        )

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
        try:
            from services.browser_tools import register_browser_tools
            register_browser_tools()
        except Exception as e:
            logger.warning("[mcp] Browser tool registration failed: %s", e)
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

    if vyact_warmup_model_id:
        try:
            from prompts import FORMAT_INSTRUCTION
            from routers.chat_helpers import load_system_prompt
            from services.conv_summary import build_summary_instruction
            from services.llm.warmup import warm_vyact_chat_prefix
            _, _, selected_system_prompt = await load_system_prompt("")
            general_chat_system_prompt = (
                selected_system_prompt or FORMAT_INSTRUCTION
            ) + build_summary_instruction("", False)
            await warm_vyact_chat_prefix(
                vyact_warmup_model_id, vyact_warmup_language, general_chat_system_prompt,
            )
        except Exception as error:
            logger.debug("[llm_warmup] Vyact warm-up skipped: %s", error)

    if not is_initial_setup:
        await warmup_kokoro_tts()

    # ── Whisper STT warm-up ──
    if not is_initial_setup:
        try:
            logger.info("[startup-status] stt")
            from routers.stt import _get_model
            loop = asyncio.get_running_loop()
            await loop.run_in_executor(None, _get_model)
            logger.info("[whisper] STT warm-up done")
        except Exception as e:
            logger.info("[whisper] STT warm-up skipped: %s", e)

    if es_available and SETUP_DONE.exists():
        from services.notification_polling import start_notification_polling
        from services.product_release_polling import start_product_release_polling
        start_notification_polling()
        start_product_release_polling()
        start_external_data_scheduler()

    yield

    try:
        await stop_external_data_scheduler()
    except Exception as e:
        logger.warning("[external-data] Scheduler shutdown cleanup failed: %s", e)

    try:
        from services.notification_polling import stop_notification_polling
        await stop_notification_polling()
    except Exception as e:
        logger.warning("[notifications] Shutdown cleanup failed: %s", e)

    try:
        from services.product_release_polling import stop_product_release_polling
        await stop_product_release_polling()
    except Exception as e:
        logger.warning("[product-releases] Shutdown cleanup failed: %s", e)

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
        from services.vyact_runtime import stop_all_vyact_runtimes
        await asyncio.to_thread(stop_all_vyact_runtimes)
    except Exception as error:
        logger.warning("Vyact runtime shutdown failed: %s", error)

    try:
        from services.db import close_shared_es
        await close_shared_es()
    except Exception as e:
        logger.warning("Elasticsearch shutdown cleanup failed: %s", e)


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
    """HTML은 갱신하고 콘텐츠 해시가 붙은 정적 자산은 장기 캐시한다."""
    response = await call_next(request)
    if request.url.path == "/":
        response.headers["Cache-Control"] = "no-store, max-age=0, must-revalidate"
    elif request.url.path.startswith("/assets/"):
        response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
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
from routers.web_document import router as web_document_router
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
from routers.knowledge_collections import router as knowledge_collections_router
from routers.external_data import router as external_data_router
from routers.language_learning_profile import router as language_learning_profile_router

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
app.include_router(web_document_router, prefix="/api")
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
app.include_router(knowledge_collections_router, prefix="/api")
app.include_router(external_data_router, prefix="/api")
app.include_router(language_learning_profile_router, prefix="/api")
from services.plugin_manager import plugin_api_dispatcher
app.mount("/api/plugin-api", plugin_api_dispatcher)

from routers.tts import router as tts_router
app.include_router(tts_router, prefix="/api")
app.include_router(browser_extension_router, prefix="/api")


# ─────────────────────────────
# SHUTDOWN ENDPOINT
# ─────────────────────────────
@app.post("/api/shutdown")
async def shutdown():
    """Electron 앱 종료 시 호출 - local model runtimes unload 후 서버 종료."""
    try:
        from services.vyact_runtime import stop_all_vyact_runtimes
        await asyncio.to_thread(stop_all_vyact_runtimes)
    except Exception as error:
        logger.error("[shutdown] Vyact runtime stop failed: %s", error)
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
