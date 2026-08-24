"""
routers/setup.py – 설치 / 모델 / Provider / 상태
"""
import asyncio
import uuid
from urllib.parse import urlparse
import math
import os
import platform
import re
import shutil

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import get_index_stats
from config import (
    DEFAULT_MODEL, INSTALL_DIR, LOGS_DIR, RECOMMENDED_MODELS,
    IMAGE_MODEL_IDS, SETUP_DONE, VENV_DIR, get_log_file,
)
from config.models import LLM_INITIAL_NUM_CTX, LLM_MAX_NUM_CTX
from routers.deps import APP_DIR, load_config_async, save_config_async, sse, write_log
from logger import DebugLogSettings, ToolLogSettings, get_logger
from services.installer import is_docker_available, Installer
from services.es_native import is_native_supported
from services.hardware_info import get_local_hardware_info
from services.huggingface_models import search_gguf_models
from services.mcp_config import ensure_mcp_config
from services.runtime_settings import DEFAULT_RUNTIME_SETTINGS, apply_runtime_settings, get_runtime_settings
from services.vyact_model_metadata_cache import get_cached_model_metadata, save_cached_model_metadata

logger = get_logger(__name__)

ANSI_ESCAPE_PATTERN = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
OLLAMA_PROGRESS_PATTERN = re.compile(r"\b(\d{1,3})%")


def start_background_services_after_setup() -> None:
    """Start services skipped during the first-run installation lifespan."""
    from services.notification_polling import start_notification_polling
    from services.product_release_polling import start_product_release_polling
    start_notification_polling()
    start_product_release_polling()


def is_japanese_system_language() -> bool:
    """Electron이 전달한 시스템 언어를 기준으로 일본어용 초기 리소스를 결정한다."""
    language = os.environ.get("VYACT_SYSTEM_LANGUAGE", "").lower().split("-", 1)[0]
    return language == "ja"


def clean_ollama_progress_line(raw_output: bytes) -> str:
    """Ollama의 터미널 제어문자를 제거하고 가장 최근 진행 상태만 반환한다."""
    decoded = raw_output.decode("utf-8", errors="replace")
    without_ansi = ANSI_ESCAPE_PATTERN.sub("", decoded)
    lines = [line.strip() for line in without_ansi.replace("\r", "\n").splitlines() if line.strip()]
    return lines[-1] if lines else ""

RUNTIME_SETTING_LIMITS = {
    "llm_temperature": (0, 1), "llm_num_ctx": (LLM_INITIAL_NUM_CTX, LLM_MAX_NUM_CTX), "llm_num_predict": (1, 131072),
    "llm_max_tokens": (1, 32768), "top_k": (0, 100), "top_p": (0, 1),
    "history_token_budget": (0, 131072), "history_chars_per_token": (0.1, 10),
    "ollama_keep_alive": (-1, None), "bge_num_ctx": (1, 8192),
    "document_chunk_size": (100, 100000), "document_chunk_overlap": (0, 99999),
}

router = APIRouter()


class ModelSelectRequest(BaseModel):
    type: str
    model: str | None = None
    model_type: str | None = None
    api_key: str | None = None
    config: dict | None = None


class ProviderConfigRequest(BaseModel):
    api_key: str
    model: str


class ProviderSelectRequest(BaseModel):
    provider: str
    model: str | None = None


class HuggingFaceTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=2048)


class HuggingFaceDownloadRequest(BaseModel):
    repository: str = Field(min_length=3, max_length=256)
    filename: str = Field(min_length=6, max_length=1024)


class VyactModelActivateRequest(BaseModel):
    model_path: str = Field(min_length=6, max_length=1024)
    context_size: int = Field(default=32768, ge=512, le=131072)


class VyactModelMetadataRequest(BaseModel):
    repository: str = Field(min_length=3, max_length=256)
    filename: str = Field(min_length=6, max_length=1024)
    revision: str = Field(min_length=1, max_length=128)
    context_size: int = Field(default=32768, ge=512, le=131072)
    architecture: str = Field(min_length=1, max_length=128)
    parameter_count: int = Field(ge=0)
    context_length: int = Field(ge=0)
    block_count: int = Field(ge=0)
    quantization: str = Field(min_length=1, max_length=64)
    kv_cache_bytes: int = Field(ge=0)
    runtime_buffer_bytes: int = Field(ge=0)
    estimated_memory_bytes: int = Field(ge=0)
    file_size_bytes: int = Field(ge=0)


class CustomProviderHeaderRequest(BaseModel):
    name: str
    value: str = ""


class CustomProviderRequest(BaseModel):
    name: str
    base_url: str
    api_key: str = ""
    model: str
    protocol: str = "openai-compatible"
    headers: list[CustomProviderHeaderRequest] = Field(default_factory=list)


BLOCKED_CUSTOM_HEADER_NAMES = {"host", "content-length", "transfer-encoding", "connection"}


def _normalize_custom_headers(
        headers: list[CustomProviderHeaderRequest], existing_headers: list[dict] | None = None,
) -> list[dict]:
    existing_by_name = {
        str(item.get("name", "")).lower(): str(item.get("value", ""))
        for item in (existing_headers or [])
    }
    normalized_headers = []
    seen_names = set()
    for header in headers:
        name = header.name.strip()
        lower_name = name.lower()
        if not name and not header.value.strip():
            continue
        if not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]+", name):
            raise HTTPException(400, f"유효하지 않은 Header 이름입니다: {name}")
        if lower_name in BLOCKED_CUSTOM_HEADER_NAMES:
            raise HTTPException(400, f"직접 설정할 수 없는 Header입니다: {name}")
        if lower_name in seen_names:
            raise HTTPException(400, f"중복된 Header입니다: {name}")
        value = header.value.strip() or existing_by_name.get(lower_name, "")
        if not value:
            raise HTTPException(400, f"Header 값이 필요합니다: {name}")
        seen_names.add(lower_name)
        normalized_headers.append({"name": name, "value": value})
    return normalized_headers


def _normalize_custom_provider_base_url(base_url: str) -> str:
    normalized = base_url.strip().rstrip("/")
    parsed = urlparse(normalized)
    if parsed.scheme not in ("http", "https") or not parsed.netloc:
        raise HTTPException(400, "Base URL은 http 또는 https URL이어야 합니다.")
    if parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise HTTPException(400, "Base URL에는 인증 정보, query 또는 fragment를 포함할 수 없습니다.")
    suffix = "/chat/completions"
    if normalized.endswith(suffix):
        normalized = normalized[:-len(suffix)]
    return normalized.rstrip("/")


# ── 상태 ──────────────────────────────────────
@router.get("/status")
async def status():
    cfg = await load_config_async()
    current_model = cfg.get("model", "")
    model_info = next((m for m in RECOMMENDED_MODELS if m["id"] == current_model), None)
    model_type = cfg.get("model_type") or (model_info["type"] if model_info else "chat")
    return {
        "status": "ok",
        "model_type": model_type,
        "is_image_model": model_type in ("image_gen", "image_edit"),
        **await get_index_stats(),
    }


# ── Setup ─────────────────────────────────────
@router.get("/setup/status")
async def setup_status():
    ram_gb = 8
    try:
        ram_bytes = os.popen("sysctl -n hw.memsize").read().strip()
        ram_gb = int(ram_bytes) // (1024 ** 3)
    except:
        pass
    return {
        "setup_done": SETUP_DONE.exists(),
        "config": await load_config_async(),
        "ram_gb": ram_gb,
        "cpu_cores": os.popen("sysctl -n hw.ncpu").read().strip(),
        "arch": platform.machine(),
        "recommended": DEFAULT_MODEL,
        "log_path": str(LOGS_DIR),
        "docker_available": await is_docker_available(),  # Docker 선택지 활성화 여부
        "native_supported": is_native_supported(),        # 설치형(네이티브) 지원 플랫폼 여부
    }


@router.post("/setup/install")
async def install(req: ModelSelectRequest):
    async def _es_already_running() -> bool:
        """ES가 이미(Docker든 네이티브든) 떠서 응답하는지 확인.

        떠 있으면 Docker 설치/ES 컨테이너 기동 단계를 건너뛴다.
        (사용자가 brew/네이티브/원격 등 Docker 외 방식으로 ES를 운영할 수 있음)
        """
        try:
            from services.db import get_es
            es = get_es()
            try:
                await es.info()
                return True
            finally:
                await es.close()
        except Exception:
            return False

    async def _prepare_common_runtime(installer: Installer):
        """Prepare runtime resources used independently of the selected LLM provider."""
        yield "Creating Python virtual environment...", "info", 74, True
        ok, msg = await installer.setup_venv()
        if not ok:
            yield msg, "error", 0, False
            return
        yield msg, "ok", 76, True

        yield "Using installed app files", "ok", 78, True
        # Electron installs requirements before starting the server, so running pip
        # again here would duplicate the same package installation work.
        yield "Python packages ready", "ok", 78, True

        yield "Preparing Vyact embedding model...", "info", 78, True
        try:
            from services.embedding_runtime import prepare_embedding_model
            await prepare_embedding_model()
            yield "Vyact embedding model ready", "ok", 81, True
        except Exception as error:
            yield f"Vyact embedding model download failed: {error}", "error", 0, False
            return

        yield "Preparing reranker model...", "info", 81, True
        try:
            from reranker import load_reranker
            if not await asyncio.to_thread(load_reranker, True):
                raise RuntimeError("Reranker model is unavailable")
            yield "Reranker model ready", "ok", 84, True
        except Exception as error:
            yield f"Reranker model download failed: {error}", "error", 0, False
            return

        yield "Preparing speech recognition model...", "info", 84, True
        try:
            from routers.stt import _get_model
            await asyncio.to_thread(_get_model, True)
            yield "Speech recognition model ready", "ok", 87, True
        except Exception as error:
            yield f"Speech recognition model download failed: {error}", "error", 0, False
            return

        if is_japanese_system_language():
            yield "Installing UniDic dictionary for Japanese TTS...", "info", 87, True
            ok, msg = await installer.install_unidic_dictionary()
            if not ok:
                yield msg, "error", 0, False
                return
            yield msg, "ok", 88, True
        else:
            yield "Japanese TTS dictionary will download when first needed", "ok", 88, True

        yield "Installing Playwright browser...", "info", 89, True
        ok, msg = await installer.install_playwright()
        if not ok:
            yield msg, "error", 0, False
            return
        yield msg, "ok", 91, True

        yield "Installing espeak-ng (Kokoro TTS)...", "info", 92, True
        ok, msg = await installer.install_espeak()
        yield msg, "ok" if ok else "log", 93, True

        yield "Downloading Kokoro TTS model...", "info", 93, True
        ok, msg = await installer.download_kokoro_model()
        if not ok:
            yield msg, "error", 0, False
            return
        yield msg, "ok", 94, True

        yield "Warming up Kokoro TTS...", "info", 94, True
        from main import warmup_kokoro_tts
        tts_ready = await warmup_kokoro_tts()
        yield (
            "Kokoro TTS ready" if tts_ready else "Kokoro TTS warm-up skipped",
            "ok" if tts_ready else "log",
            95,
            True,
        )

    async def _stream_common_runtime(installer: Installer):
        async for message, level, progress, should_continue in _prepare_common_runtime(installer):
            yield sse(message, level, progress), should_continue

    async def stream():
        request_config = req.config or {}
        persisted_setup_config = {"es_mode": request_config.get("es_mode", "docker")}
        if req.type == "ollama":
            cfg = {
                "type": "ollama",
                "model": req.model,
                "model_type": req.model_type or "chat",
                "ollama_config": {"model": req.model},
                "config": persisted_setup_config,
            }
        elif req.type == "vyact":
            if not req.model:
                yield sse("Vyact 모델을 먼저 다운로드하고 선택하세요.", "error", 0)
                return
            existing_config = await load_config_async()
            vyact_config = existing_config.get("vyact_config", {})
            cfg = {
                "type": "vyact",
                "model": req.model,
                "vyact_config": {
                    **vyact_config,
                    "model": req.model,
                    "model_path": request_config.get("model_path", vyact_config.get("model_path", "")),
                },
                "config": persisted_setup_config,
            }
        elif req.type == "custom":
            connection_name = str(request_config.get("name", "")).strip()
            protocol = str(request_config.get("protocol", "openai-compatible")).strip()
            if protocol != "openai-compatible":
                yield sse("지원하지 않는 API 형식입니다.", "error", 0)
                return
            try:
                base_url = _normalize_custom_provider_base_url(str(request_config.get("base_url", "")))
                custom_headers = _normalize_custom_headers([
                    CustomProviderHeaderRequest.model_validate(item)
                    for item in request_config.get("headers", [])
                ])
            except HTTPException as error:
                yield sse(str(error.detail), "error", 0)
                return
            except Exception:
                yield sse("Header 설정 형식이 올바르지 않습니다.", "error", 0)
                return
            model = (req.model or "").strip()
            if not connection_name or not model:
                yield sse("이름, Base URL, Model ID가 필요합니다.", "error", 0)
                return
            connection_id = uuid.uuid4().hex
            cfg = {
                "type": f"custom:{connection_id}",
                "model": model,
                "custom_providers": [{
                    "id": connection_id,
                    "name": connection_name,
                    "protocol": protocol,
                    "base_url": base_url,
                    "api_key": (req.api_key or "").strip(),
                    "model": model,
                    "headers": custom_headers,
                }],
                "config": persisted_setup_config,
            }
        elif req.type in ("openai", "gemini", "claude"):
            if not req.api_key or not req.model:
                yield sse("API Key와 Model ID가 필요합니다.", "error", 0)
                return
            cfg = {
                "type": req.type,
                "model": req.model,
                f"{req.type}_config": {"api_key": req.api_key, "model": req.model},
                "config": persisted_setup_config,
            }
        else:
            yield sse("지원하지 않는 provider", "error", 0)
            return

        if req.type == "ollama":
            installer = Installer(INSTALL_DIR, APP_DIR, VENV_DIR, get_log_file("event"))
            model = req.model

            # ── ES 설치 방식: 'docker'(기본) 또는 'native'(바이너리 직접 설치) ──
            es_mode = (req.config or {}).get("es_mode", "docker")

            # ES가 이미 떠 있으면 어느 방식이든 ES 준비 단계를 건너뛴다.
            yield sse("Checking Elasticsearch...", "info", 3)
            es_running = await _es_already_running()

            if es_running:
                yield sse("Existing Elasticsearch detected — skipping ES installation", "ok", 15)
            elif es_mode == "native":
                from services.es_native import install_native_es, is_native_supported
                if not is_native_supported():
                    yield sse("Native ES is only supported on Windows/Apple Silicon Mac. Please select Docker.", "error", 0)
                    return
                es_ok = False
                async for pct, msg, level in install_native_es():
                    # native 설치 진행률(0~100)을 전체 흐름의 3~15% 구간으로 압축 매핑
                    mapped = 3 + int(pct * 0.12)
                    yield sse(msg, level, mapped)
                    if level == "error":
                        return
                    if pct >= 100:
                        es_ok = True
                es_running = es_ok  # 뒤쪽 "ES 시작" 단계를 건너뛰게
            else:
                yield sse("Checking Docker...", "info", 5)
                ok, msg = await installer.check_docker()
                if not ok:
                    yield sse(msg, "error", 0)
                    return
                yield sse(msg, "ok", 15)

            yield sse("Checking Ollama...", "info", 18)
            if shutil.which("ollama") is None and shutil.which("brew") is None:
                yield sse(
                    "Homebrew is required to install Ollama",
                    "error",
                    0,
                    i18n_key="homebrewRequired",
                )
                return
            ok, msg = await installer.install_ollama()
            if not ok: yield sse(msg, "error", 0); return
            yield sse(msg, "ok", 25)

            yield sse("Checking Ollama server...", "info", 27)
            ok, msg = await installer.start_ollama_server()
            if not ok:
                yield sse(msg, "error", 0)
                return
            yield sse(msg, "ok", 30)

            yield sse(f"Downloading {model}...", "info", 33)
            try:
                async for line, progress in installer.download_model(model):
                    yield sse(line, "log", progress)
                yield sse(f"{model} download complete", "ok", 65)
            except Exception as e:
                write_log("model_download_failed", {"model": model, "error": str(e)})
                yield sse(str(e), "error", 0);
                return

            async for event, should_continue in _stream_common_runtime(installer):
                yield event
                if not should_continue:
                    return

            # ES가 이미 떠 있으면 컨테이너 기동을 건너뛴다(위에서 감지)
            if es_running:
                yield sse("Using existing Elasticsearch — skipping start", "ok", 99)
            else:
                yield sse("Starting Elasticsearch...", "info", 95)
                ok, msg = await installer.start_elasticsearch()
                if not ok:
                    yield sse(msg, "error", 0)
                    return
                yield sse(msg, "ok", 99)

            # ES 인덱스 초기화 후 config 저장
            try:
                from agent import (
                    ensure_index, load_prompts_cache,
                )
                from routers.skills import ensure_skills_index
                await ensure_index()
                await ensure_skills_index()
                await ensure_mcp_config()
                await save_config_async(cfg)
                await load_prompts_cache()
                logger.info("[setup] config ES 저장 및 초기 데이터 로드 완료")
            except Exception as e:
                logger.exception("[setup] 초기화 실패")
                yield sse(f"Setup initialization failed: {e}", "error", 0)
                return

            # 메모리가 부족해 하나의 모델만 상주할 수 있으면, 설치 직후 바로 사용하는
            # 채팅 모델이 남도록 bge-m3를 먼저 예열하고 채팅 모델을 마지막에 올린다.
            yield sse(f"Loading {model} into memory...", "info", 96)
            try:
                from services.ollama_manager import get_loaded_model_names, load_model

                chat_ready = await load_model(model)
                loaded_models = await get_loaded_model_names()
                model_loaded = any(name.split(":", 1)[0] == model.split(":", 1)[0] for name in loaded_models)

                if chat_ready and model_loaded:
                    yield sse(f"{model} ready in memory", "ok", 98)
                    try:
                        from routers.deps import load_ui_language_async
                        from services.llm.warmup import warm_ollama_chat_prefix

                        yield sse("Warming up chat…", "info", 99)
                        if await warm_ollama_chat_prefix(model, await load_ui_language_async() or ""):
                            logger.info("[setup] Ollama chat prefix warm-up completed")
                    except Exception as warmup_error:
                        logger.debug("[setup] Ollama chat prefix warm-up skipped: %s", warmup_error)
                else:
                    yield sse(f"{model} could not stay loaded (memory may be insufficient)", "log", 98)
            except Exception as e:
                logger.warning("[setup] Ollama model warm-up failed: %s", e)
                yield sse(f"Model warm-up failed: {e}", "log", 98)

            SETUP_DONE.touch()
            start_background_services_after_setup()
            yield sse("Installation complete!", "done", 100)
        else:
            installer = Installer(INSTALL_DIR, APP_DIR, VENV_DIR, get_log_file("event"))

            yield sse("Preparing LLM connection...", "info", 10)

            if req.type == "vyact":
                from services.vyact_runtime import install_missing_runtime
                yield sse("Checking Vyact local runtime...", "info", 12)
                try:
                    async for message in install_missing_runtime():
                        yield sse(message, "info", 16)
                except Exception as error:
                    logger.warning("[setup] Vyact runtime installation failed: %s", error)
                    yield sse(f"Vyact 런타임 설치 실패: {error}", "error", 0)
                    return

            # ── ES 설치 (클라우드도 ES 필수) ──
            es_mode = (req.config or {}).get("es_mode", "docker")

            yield sse("Checking Elasticsearch...", "info", 20)
            es_running = await _es_already_running()

            if es_running:
                yield sse("Existing Elasticsearch detected — skipping ES installation", "ok", 50)
            elif es_mode == "native":
                from services.es_native import install_native_es, is_native_supported
                if not is_native_supported():
                    yield sse("Native ES is only supported on Windows/Apple Silicon Mac. Please select Docker.", "error", 0)
                    return
                async for pct, msg, level in install_native_es():
                    mapped = 20 + int(pct * 0.3)
                    yield sse(msg, level, mapped)
                    if level == "error":
                        return
                    if pct >= 100:
                        es_running = True
            else:
                yield sse("Checking Docker...", "info", 25)
                ok, msg = await installer.check_docker()
                if not ok:
                    yield sse(msg, "error", 0)
                    return
                yield sse(msg, "ok", 35)

            if not es_running:
                yield sse("Starting Elasticsearch...", "info", 50)
                ok, msg = await installer.start_elasticsearch()
                if not ok:
                    yield sse(msg, "error", 0)
                    return
                yield sse(msg, "ok", 70)

            async for event, should_continue in _stream_common_runtime(installer):
                yield event
                if not should_continue:
                    return

            # ES 인덱스 초기화
            try:
                from agent import ensure_index, load_prompts_cache
                from routers.skills import ensure_skills_index
                await ensure_index()
                await ensure_skills_index()
                await ensure_mcp_config()
                if req.type == "vyact":
                    from services.vyact_runtime import get_downloaded_model_path, start_single_model
                    model_path = get_downloaded_model_path(cfg["vyact_config"]["model_path"])
                    model_id = await asyncio.to_thread(
                        start_single_model, model_path, cfg["vyact_config"].get("context_size", 32768),
                    )
                    cfg["model"] = model_id
                    cfg["vyact_config"]["model"] = model_id
                await save_config_async(cfg)
                await load_prompts_cache()
                logger.info("[setup] LLM connection config saved after ES initialization")
            except Exception as e:
                logger.exception("[setup] Cloud setup init failed")
                yield sse(f"Setup initialization failed: {e}", "error", 0)
                return

            SETUP_DONE.touch()
            start_background_services_after_setup()
            yield sse("Setup complete!", "done", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Models ────────────────────────────────────
@router.get("/models")
async def get_models():
    EMBED_MODELS = {"bge-m3", "nomic-embed-text", "mxbai-embed-large"}
    recommended_ids = [m["id"] for m in RECOMMENDED_MODELS]
    cfg = await load_config_async()
    if cfg.get("type") == "vyact":
        from services.vyact_runtime import list_downloaded_models
        installed_models = list_downloaded_models()
        return {
            "models": [[model] for model in installed_models],
            "current": cfg.get("vyact_config", {}).get("model_path", ""),
            "installed": installed_models,
            "model_type": "chat",
        }
    installed_models = []
    try:
        proc = await asyncio.create_subprocess_exec(
            "ollama", "list",
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()
        if proc.returncode == 0:
            for line in stdout.decode().strip().split("\n")[1:]:
                if line.strip():
                    parts = line.split()
                    if parts:
                        name = parts[0]
                        base = name.split(":")[0]
                        if base not in EMBED_MODELS:
                            installed_models.append(name)
    except Exception as e:
        logger.warning("모델 목록 조회 실패: %s", e)

    installed_models = list(dict.fromkeys(installed_models))
    all_models = list(dict.fromkeys(recommended_ids + installed_models))
    return {
        "models": [[m] for m in all_models],
        "current": cfg.get("model", ""),
        "installed": installed_models,
        "model_type": cfg.get("model_type") or next(
            (model["type"] for model in RECOMMENDED_MODELS if model["id"] == cfg.get("model")),
            "chat",
        ),
    }


@router.get("/models/recommended")
async def get_recommended_models():
    return {"models": RECOMMENDED_MODELS, "default": DEFAULT_MODEL}


@router.get("/vyact/models/search")
async def search_vyact_models(q: str = Query("", max_length=200)):
    """Search GGUF repositories only; model file selection stays explicit in the UI."""
    try:
        return {
            "models": await search_gguf_models(q),
            "hardware": get_local_hardware_info(),
        }
    except Exception as error:
        logger.warning("[vyact] Hugging Face search failed: %s", error)
        raise HTTPException(502, "Hugging Face 모델 검색에 실패했습니다.") from error


@router.get("/vyact/models/metadata-cache")
async def get_vyact_model_metadata_cache(
        repository: str = Query(..., min_length=3, max_length=256),
        filename: str = Query(..., min_length=6, max_length=1024),
        revision: str = Query(..., min_length=1, max_length=128),
        context_size: int = Query(32768, ge=512, le=131072),
):
    try:
        metadata = await get_cached_model_metadata(repository, filename, revision, context_size)
        return {"metadata": metadata}
    except Exception as error:
        logger.warning("[vyact] Model metadata cache lookup failed: %s", error)
        return {"metadata": None}


@router.post("/vyact/models/metadata-cache")
async def save_vyact_model_metadata_cache(req: VyactModelMetadataRequest):
    try:
        document_id = await save_cached_model_metadata(
            req.repository, req.filename, req.revision, req.context_size,
            {
                "architecture": req.architecture,
                "parameter_count": req.parameter_count,
                "context_length": req.context_length,
                "block_count": req.block_count,
                "quantization": req.quantization,
                "kv_cache_bytes": req.kv_cache_bytes,
                "runtime_buffer_bytes": req.runtime_buffer_bytes,
                "estimated_memory_bytes": req.estimated_memory_bytes,
                "file_size_bytes": req.file_size_bytes,
            },
        )
        return {"saved": True, "id": document_id}
    except Exception as error:
        logger.warning("[vyact] Model metadata cache save failed: %s", error)
        return {"saved": False}


@router.post("/vyact/huggingface-token")
async def save_vyact_huggingface_token(req: HuggingFaceTokenRequest):
    config = await load_config_async()
    config.setdefault("vyact_config", {})["huggingface_token"] = req.token.strip()
    await save_config_async(config)
    return {"ok": True}


@router.post("/vyact/runtime/install")
async def install_vyact_runtime():
    async def stream():
        from services.vyact_runtime import install_missing_runtime

        try:
            async for message in install_missing_runtime():
                yield sse(message, "info")
        except Exception as error:
            logger.warning("[vyact] native runtime installation failed: %s", error)
            yield sse(f"Vyact 런타임 설치 실패: {error}", "error", 0)
            return
        yield sse("Vyact 런타임 설치 완료", "ok", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/vyact/runtime/update")
async def update_vyact_runtime():
    async def stream():
        from services.vyact_runtime import get_native_update_commands

        commands = get_native_update_commands()
        if not commands:
            yield sse("패키지 관리자를 통한 런타임 업데이트를 지원하지 않는 환경입니다.", "error", 0)
            return
        for command in commands:
            process = await asyncio.create_subprocess_exec(
                *command,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.STDOUT,
            )
            assert process.stdout is not None
            async for raw in process.stdout:
                line = raw.decode("utf-8", errors="replace").strip()
                if line:
                    yield sse(line, "log")
            if await process.wait() != 0:
                yield sse("Vyact 런타임 업데이트에 실패했습니다.", "error", 0)
                return
        yield sse("Vyact 런타임 업데이트 완료", "ok", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/vyact/models/download")
async def download_vyact_model(req: HuggingFaceDownloadRequest):
    async def stream():
        from services.huggingface_models import download_gguf_model

        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")
        try:
            async for downloaded, total in download_gguf_model(req.repository, req.filename, token):
                progress = int(downloaded * 100 / total) if total else None
                yield sse(f"Downloading {req.filename}", "log", progress)
        except Exception as error:
            logger.warning("[vyact] GGUF download failed: %s", error)
            yield sse(f"모델 다운로드 실패: {error}", "error", 0)
            return
        yield sse(f"{req.filename} 다운로드 완료", "ok", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/vyact/models/activate")
async def activate_vyact_model(req: VyactModelActivateRequest):
    async def stream():
        from services.vyact_runtime import get_downloaded_model_path, start_single_model

        yield sse("Vyact 모델을 메모리에 로드하는 중...", "model_loading", 10)
        try:
            model_path = get_downloaded_model_path(req.model_path)
            model_id = await asyncio.to_thread(start_single_model, model_path, req.context_size)
            config = await load_config_async()
            config["type"] = "vyact"
            config["model"] = model_id
            config.setdefault("vyact_config", {}).update({
                "model": model_id,
                "model_path": req.model_path,
                "context_size": req.context_size,
            })
            await save_config_async(config)
        except Exception as error:
            logger.warning("[vyact] model activation failed: %s", error)
            yield sse(f"Vyact 모델 로드 실패: {error}", "error", 0)
            return
        yield sse("Vyact 모델 준비 완료", "done", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.post("/models/select")
async def select_model(req: ModelSelectRequest):
    async def stream():
        config = await load_config_async()
        if req.type == "ollama":
            model = req.model
            # 현재 로드된 모델 확인 (변경 전)
            prev_config = await load_config_async()
            prev_model = prev_config.get("model") if prev_config.get("type") == "ollama" else None

            config.setdefault("ollama_config", {})["model"] = req.model
            config["type"] = "ollama"
            config["model"] = req.model
            recommended_model = next((m for m in RECOMMENDED_MODELS if m["id"] == req.model), None)
            config["model_type"] = req.model_type or (
                recommended_model["type"] if recommended_model else "chat"
            )
        else:
            if req.type not in ("openai", "gemini", "claude"):
                yield sse("지원하지 않는 provider", "error", 0)
                return
            if not req.api_key:
                yield sse(f"{req.type.upper()} API KEY 필요", "error", 0)
                return
            config["type"] = req.type
            config["model"] = req.model
            # 초기 설정에서도 Provider 설정 화면과 같은 구조를 사용한다.
            # 그렇지 않으면 설정 완료 직후 Sidebar에서 해당 Provider를 찾지 못한다.
            config[f"{req.type}_config"] = {
                "api_key": req.api_key,
                "model": req.model,
            }
        await save_config_async(config)

        if req.type == "ollama":
            yield sse("Ollama 모드 설정", "info", 20)
            proc = await asyncio.create_subprocess_exec(
                "ollama", "list",
                stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
            )
            stdout, _ = await proc.communicate()
            if model not in stdout.decode():
                yield sse(f"모델 미설치: {model}", "info", 30)
                yield sse("자동 다운로드 시작...", "info", 35)
                pull = await asyncio.create_subprocess_exec(
                    "ollama", "pull", model,
                    stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                pull_progress = 0
                async for raw in pull.stdout:
                    line = clean_ollama_progress_line(raw)
                    if line:
                        progress_matches = OLLAMA_PROGRESS_PATTERN.findall(line)
                        if progress_matches:
                            pull_progress = min(int(progress_matches[-1]), 100)
                        yield sse(line, "log", pull_progress)
                if await pull.wait() != 0:
                    yield sse("❌ 모델 다운로드 실패", "error", 0);
                    return
                yield sse(f"✅ {model} 다운로드 완료", "info", 100)
            else:
                yield sse(f"✅ {model} 이미 설치됨", "info", 50)

            # 기존 모델 언로드 → 새 모델 로드
            yield sse("모델 메모리 로드 중...", "model_loading", 100)
            from services.ollama_manager import switch_model
            await switch_model(prev_model, model)
            yield sse("Ollama 설정 완료", "ok", 100)
        elif req.type in ("openai", "gemini", "claude"):
            yield sse(f"{req.type} 설정 완료", "ok", 100)
        else:
            yield sse("지원하지 않는 provider", "error", 0);
            return

        yield sse("설정 저장 완료", "done", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Providers ────────────────────────────────
@router.get("/providers")
async def get_providers():
    config = await load_config_async()
    providers = {}
    for p in ["openai", "gemini", "claude"]:
        pc = config.get(f"{p}_config")
        if pc:
            key = pc.get("api_key", "")
            providers[p] = {
                "model": pc.get("model"),
                "has_key": bool(key),
                "key_preview": f"{key[:8]}..." if len(key) > 8 else "",
            }
    vyact_config = config.get("vyact_config", {})
    providers["vyact"] = {
        "model": vyact_config.get("model"),
        "has_key": bool(vyact_config.get("model")),
    }
    return {
        "current_type": config.get("type", "ollama"),
        "current_model": config.get("model"),
        "providers": providers,
        "custom_providers": [
            {
                "id": item.get("id"),
                "name": item.get("name"),
                "protocol": "openai-compatible",
                "base_url": item.get("base_url"),
                "model": item.get("model"),
                "has_key": bool(item.get("api_key")),
                "headers": [
                    {"name": header.get("name"), "has_value": bool(header.get("value"))}
                    for header in item.get("headers", [])
                ],
            }
            for item in config.get("custom_providers", [])
        ],
    }


@router.post("/providers/custom")
async def create_custom_provider(req: CustomProviderRequest):
    name = req.name.strip()
    model = req.model.strip()
    if not name or not model:
        raise HTTPException(400, "이름과 Model ID가 필요합니다.")
    if req.protocol != "openai-compatible":
        raise HTTPException(400, "지원하지 않는 API 형식입니다.")
    config = await load_config_async()
    connection = {
        "id": uuid.uuid4().hex,
        "name": name,
        "protocol": "openai-compatible",
        "base_url": _normalize_custom_provider_base_url(req.base_url),
        "api_key": req.api_key.strip(),
        "model": model,
        "headers": _normalize_custom_headers(req.headers),
    }
    config.setdefault("custom_providers", []).append(connection)
    await save_config_async(config)
    return {"ok": True, "id": connection["id"]}


@router.put("/providers/custom/{connection_id}")
async def update_custom_provider(connection_id: str, req: CustomProviderRequest):
    config = await load_config_async()
    connection = next((item for item in config.get("custom_providers", []) if item.get("id") == connection_id), None)
    if connection is None:
        raise HTTPException(404, "사용자 연결을 찾을 수 없습니다.")
    name = req.name.strip()
    model = req.model.strip()
    if not name or not model:
        raise HTTPException(400, "이름과 Model ID가 필요합니다.")
    if req.protocol != "openai-compatible":
        raise HTTPException(400, "지원하지 않는 API 형식입니다.")
    connection.update({
        "name": name,
        "base_url": _normalize_custom_provider_base_url(req.base_url),
        "model": model,
        "headers": _normalize_custom_headers(req.headers, connection.get("headers")),
    })
    if req.api_key.strip():
        connection["api_key"] = req.api_key.strip()
    await save_config_async(config)
    return {"ok": True}


@router.delete("/providers/custom/{connection_id}")
async def delete_custom_provider(connection_id: str):
    config = await load_config_async()
    before = config.get("custom_providers", [])
    remaining = [item for item in before if item.get("id") != connection_id]
    if len(remaining) == len(before):
        raise HTTPException(404, "사용자 연결을 찾을 수 없습니다.")
    config["custom_providers"] = remaining
    if config.get("type") == f"custom:{connection_id}":
        config["type"] = "ollama"
        config["model"] = config.get("ollama_config", {}).get("model", DEFAULT_MODEL)
    await save_config_async(config)
    return {"ok": True}


@router.post("/providers/{provider}")
async def save_provider(provider: str, req: ProviderConfigRequest):
    if provider not in ["openai", "gemini", "claude"]:
        raise HTTPException(400, "지원하지 않는 provider")
    try:
        config = await load_config_async()
        existing = config.get(f"{provider}_config", {})
        api_key = req.api_key.strip() or existing.get("api_key", "")
        if not api_key:
            raise HTTPException(400, "API Key가 필요합니다.")
        config[f"{provider}_config"] = {"api_key": api_key, "model": req.model.strip()}
        await save_config_async(config)
        return {"ok": True}
    except Exception as e:
        write_log("provider_save_failed", {"provider": provider, "model": req.model, "error": str(e)})
        raise HTTPException(500, f"Provider 설정 저장 실패: {str(e)}")


@router.delete("/providers/{provider}")
async def delete_provider(provider: str):
    config = await load_config_async()
    config.pop(f"{provider}_config", None)
    await save_config_async(config)
    return {"ok": True}


@router.post("/provider/select")
async def select_provider(req: ProviderSelectRequest):
    config = await load_config_async()
    if req.provider == "ollama":
        config["type"] = "ollama"
        config.setdefault("ollama_config", {"model": DEFAULT_MODEL})
        if req.model:
            config["ollama_config"]["model"] = req.model
        config["model"] = config["ollama_config"]["model"]
    elif req.provider == "vyact":
        vyact_config = config.get("vyact_config", {})
        model = req.model or vyact_config.get("model")
        if not model:
            raise HTTPException(400, "Vyact 모델이 없습니다. 먼저 모델을 다운로드하세요.")
        config["type"] = "vyact"
        config["model"] = model
        config.setdefault("vyact_config", {})["model"] = model
    else:
        if req.provider.startswith("custom:"):
            connection_id = req.provider.removeprefix("custom:")
            connection = next(
                (item for item in config.get("custom_providers", []) if item.get("id") == connection_id),
                None,
            )
            if connection is None:
                raise HTTPException(404, "사용자 연결을 찾을 수 없습니다.")
            config["type"] = req.provider
            if req.model:
                connection["model"] = req.model
            config["model"] = connection["model"]
        elif req.provider not in ("openai", "gemini", "claude"):
            raise HTTPException(400, "지원하지 않는 provider")
        else:
            key = f"{req.provider}_config"
            if not config.get(key, {}).get("api_key"):
                raise HTTPException(400, f"{req.provider} 설정이 없습니다. 먼저 API Key를 등록하세요.")
            config["type"] = req.provider
            if req.model:
                config[key]["model"] = req.model
                config["model"] = req.model
            else:
                config["model"] = config[key]["model"]
    await save_config_async(config)
    return {"ok": True, "config": config}


# ─────────────────────────────
# LLM 로깅 설정
# ─────────────────────────────
@router.get("/settings/llm-logging")
async def get_llm_logging():
    cfg = await load_config_async()
    return {"llm_logging": cfg.get("llm_logging", False)}


@router.post("/settings/llm-logging")
async def set_llm_logging(body: dict):
    cfg = await load_config_async()
    cfg["llm_logging"] = bool(body.get("enabled", False))
    await save_config_async(cfg)
    return {"llm_logging": cfg["llm_logging"]}


@router.get("/settings/tool-logging")
async def get_tool_logging():
    cfg = await load_config_async()
    enabled = cfg.get("tool_logging", True)
    ToolLogSettings.set_enabled(enabled)
    return {"tool_logging": enabled}


@router.post("/settings/tool-logging")
async def set_tool_logging(body: dict):
    cfg = await load_config_async()
    cfg["tool_logging"] = bool(body.get("enabled", False))
    await save_config_async(cfg)
    ToolLogSettings.set_enabled(cfg["tool_logging"])
    return {"tool_logging": cfg["tool_logging"]}


@router.get("/settings/debug-logging")
async def get_debug_logging():
    cfg = await load_config_async()
    enabled = cfg.get("debug_logging", cfg.get("tool_debug_logging", False))
    DebugLogSettings.set_enabled(enabled)
    return {"debug_logging": enabled}


@router.post("/settings/debug-logging")
async def set_debug_logging(body: dict):
    cfg = await load_config_async()
    cfg["debug_logging"] = bool(body.get("enabled", False))
    cfg.pop("tool_debug_logging", None)
    await save_config_async(cfg)
    DebugLogSettings.set_enabled(cfg["debug_logging"])
    return {"debug_logging": cfg["debug_logging"]}


@router.get("/settings/runtime")
async def get_runtime_settings_endpoint():
    cfg = await load_config_async()
    return apply_runtime_settings(cfg.get("runtime_settings"))


@router.post("/settings/runtime")
async def set_runtime_settings_endpoint(body: dict):
    values = body if isinstance(body, dict) else {}
    for key, value in values.items():
        if key not in RUNTIME_SETTING_LIMITS:
            continue
        if value is None:
            continue
        if not isinstance(value, (int, float)) or not math.isfinite(value):
            raise HTTPException(400, f"{key}은(는) 숫자여야 합니다.")
        minimum, maximum = RUNTIME_SETTING_LIMITS[key]
        if value < minimum or (maximum is not None and value > maximum):
            upper = "제한 없음" if maximum is None else str(maximum)
            raise HTTPException(400, f"{key} 값은 {minimum}~{upper} 범위여야 합니다.")
    if values.get("document_chunk_size", 1200) < 100 or values.get("document_chunk_overlap", 150) < 0:
        raise HTTPException(400, "청크 크기는 100 이상이고 겹침은 0 이상이어야 합니다.")
    if values.get("document_chunk_overlap", 0) >= values.get("document_chunk_size", 1):
        raise HTTPException(400, "청크 겹침은 청크 크기보다 작아야 합니다.")
    cfg = await load_config_async()
    merged = {**DEFAULT_RUNTIME_SETTINGS, **cfg.get("runtime_settings", {}), **values}
    cfg["runtime_settings"] = apply_runtime_settings(merged)
    await save_config_async(cfg)
    return cfg["runtime_settings"]


# ─────────────────────────────
# TTS 설정
# ─────────────────────────────
@router.get("/settings/tts")
async def get_tts_settings():
    cfg = await load_config_async()
    return {
        "rate": cfg.get("tts_rate", 1.0),
        "volume": cfg.get("tts_volume", 1.0),
        "enVoiceURI": cfg.get("tts_en_voice_uri", cfg.get("tts_voice_uri", "")),  # 구버전 호환
        "kokoroVoice": cfg.get("tts_kokoro_voice", "af_heart"),
    }


@router.post("/settings/tts")
async def set_tts_settings(body: dict):
    cfg = await load_config_async()
    cfg["tts_rate"] = float(body.get("rate", 1.0))
    cfg["tts_volume"] = float(body.get("volume", 1.0))
    cfg["tts_en_voice_uri"] = str(body.get("enVoiceURI", ""))
    cfg["tts_kokoro_voice"] = str(body.get("kokoroVoice", ""))
    await save_config_async(cfg)
    return {
        "rate": cfg["tts_rate"], "volume": cfg["tts_volume"],
        "enVoiceURI": cfg["tts_en_voice_uri"], "kokoroVoice": cfg["tts_kokoro_voice"],
    }
