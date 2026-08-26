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

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field, model_validator

from agent import ensure_index, get_index_stats, load_prompts_cache
from config import INSTALL_DIR, LOGS_DIR, SETUP_DONE, VENV_DIR, get_log_file
from routers.deps import APP_DIR, load_config_async, save_config_async, sse, write_log
from logger import DebugLogSettings, ToolLogSettings, get_logger
from services.installer import is_docker_available, Installer
from services.es_native import is_native_supported
from services.hardware_info import get_local_hardware_info
from services.huggingface_models import search_gguf_models
from services.mcp_config import ensure_mcp_config
from services.runtime_settings import DEFAULT_RUNTIME_SETTINGS, apply_runtime_settings
from services.model_runtime_profiles import delete_model_profile, get_model_profile, normalize_model_profile, recommended_model_profile, save_model_profile
from services.vyact_model_metadata_cache import get_cached_model_metadata, save_cached_model_metadata
from services.mlx_runtime import get_downloaded_mlx_model_path, get_mlx_runtime_capabilities
from services.reasoning_capabilities import get_gguf_reasoning_capabilities, get_mlx_reasoning_capabilities
from services.vyact_runtime import get_downloaded_model_path

logger = get_logger(__name__)

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


RUNTIME_SETTING_LIMITS = {
    "bge_num_ctx": (1, 8192),
    "document_chunk_size": (100, 100000), "document_chunk_overlap": (0, 99999),
}
def _profile_runtime_settings(profile: dict) -> dict:
    history_token_budget = profile.get("history_token_budget")
    return {
        "llm_num_ctx": profile.get("context_size", 32768),
        "llm_num_predict": profile.get("max_output_tokens", 2048),
        "llm_max_tokens": profile.get("max_output_tokens", 2048),
        "llm_temperature": profile.get("temperature", 0.2),
        "top_k": profile.get("top_k"), "top_p": profile.get("top_p"),
        "seed": profile.get("seed"),
        "history_token_budget": 16384 if history_token_budget is None else history_token_budget,
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
    history_token_budget: int = Field(default=16384, ge=0, le=131072)
    temperature: float = Field(default=0.2, ge=0, le=1)
    max_output_tokens: int = Field(default=2048, ge=1, le=32768)


class ProviderSelectRequest(BaseModel):
    provider: str
    model: str | None = None


class HuggingFaceTokenRequest(BaseModel):
    token: str = Field(min_length=1, max_length=2048)


class HuggingFaceDownloadRequest(BaseModel):
    repository: str = Field(min_length=3, max_length=256)
    filename: str = Field(min_length=6, max_length=1024)
    revision: str = Field(default="main", min_length=1, max_length=128)
    runtime: str = Field(default="gguf", pattern="^(gguf|mlx)$")
    token: str | None = Field(default=None, max_length=2048)
    total_size_bytes: int = Field(default=0, ge=0)
    mtp_repository: str | None = Field(default=None, min_length=3, max_length=256)
    mtp_revision: str | None = Field(default=None, min_length=1, max_length=128)
    mtp_size_bytes: int = Field(default=0, ge=0)


class VyactModelActivateRequest(BaseModel):
    model_path: str = Field(min_length=6, max_length=1024)
    context_size: int = Field(default=32768, ge=512, le=131072)
    runtime: str = Field(default="gguf", pattern="^(gguf|mlx)$")
    repository: str | None = Field(default=None, min_length=3, max_length=256)
    max_output_tokens: int = Field(default=4096, ge=1, le=32768)
    history_token_budget: int = Field(default=16384, ge=0, le=131072)
    temperature: float = Field(default=0.2, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=100)
    top_p: float | None = Field(default=None, ge=0, le=1)
    cache_quantization: bool = True
    mtp_enabled: bool | None = None
    kv_cache_precision: str | None = Field(default=None, pattern="^(none|q8|q4)$")
    performance_mode: str = Field(default="auto", pattern="^(auto|memory|performance)$")
    cpu_threads: int | None = Field(default=None, ge=1, le=256)
    seed: int | None = Field(default=None, ge=0, le=2147483647)

    @model_validator(mode="after")
    def validate_acceleration_settings(self):
        if self.mtp_enabled is True and (self.kv_cache_precision or ("q8" if self.cache_quantization else "none")) != "none":
            raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
        return self


class VyactModelProfileRequest(BaseModel):
    model_path: str = Field(min_length=1, max_length=1024)
    runtime: str = Field(default="gguf", pattern="^(gguf|mlx)$")
    repository: str | None = Field(default=None, max_length=256)
    context_size: int = Field(default=32768, ge=512, le=131072)
    max_output_tokens: int = Field(default=4096, ge=1, le=32768)
    history_token_budget: int = Field(default=16384, ge=0, le=131072)
    temperature: float = Field(default=0.2, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=100)
    top_p: float | None = Field(default=None, ge=0, le=1)
    cache_quantization: bool = True
    mtp_enabled: bool | None = None
    kv_cache_precision: str | None = Field(default=None, pattern="^(none|q8|q4)$")
    performance_mode: str = Field(default="auto", pattern="^(auto|memory|performance)$")
    cpu_threads: int | None = Field(default=None, ge=1, le=256)
    seed: int | None = Field(default=None, ge=0, le=2147483647)

    @model_validator(mode="after")
    def validate_acceleration_settings(self):
        if self.mtp_enabled is True and (self.kv_cache_precision or ("q8" if self.cache_quantization else "none")) != "none":
            raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
        return self


class VyactModelDeleteRequest(BaseModel):
    model_path: str = Field(min_length=1, max_length=1024)


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
    model_type = cfg.get("model_type", "chat")
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
        if req.type == "vyact":
            if not req.model:
                yield sse("Vyact 모델을 먼저 다운로드하고 선택하세요.", "error", 0)
                return
            existing_config = await load_config_async()
            vyact_config = existing_config.get("vyact_config", {})
            huggingface_token = str(request_config.get("huggingface_token", "")).strip()
            cfg = {
                "type": "vyact",
                "model": req.model,
                "model_type": "chat",
                "vyact_config": {
                    **vyact_config,
                    "model": req.model,
                    "model_path": request_config.get("model_path", vyact_config.get("model_path", "")),
                    "runtime": request_config.get("runtime", vyact_config.get("runtime", "gguf")),
                    "repository": request_config.get("repository", vyact_config.get("repository")),
                    **({"huggingface_token": huggingface_token} if huggingface_token else {}),
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

        if req.type in ("vyact", "custom", "openai", "gemini", "claude"):
            installer = Installer(INSTALL_DIR, APP_DIR, VENV_DIR, get_log_file("event"))

            yield sse("Preparing LLM connection...", "info", 10)

            # 최초에 MLX 모델을 선택했더라도 이후 GGUF 모델로 바로 전환할 수 있도록
            # Vyact 설치 시 네이티브 llama.cpp + llama-swap 런타임을 함께 준비한다.
            if req.type == "vyact":
                from services.vyact_runtime import RuntimePackageManagerMissingError, install_missing_runtime
                yield sse("Checking Vyact local runtime...", "info", 12)
                try:
                    async for message in install_missing_runtime():
                        yield sse(message, "info", 16)
                except RuntimePackageManagerMissingError:
                    yield sse(
                        "자동 설치에 필요한 패키지 관리자를 찾지 못했습니다.",
                        "runtime_package_manager_missing",
                        0,
                    )
                    return
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

            # Preserve the optional Hugging Face token as soon as Elasticsearch is
            # available. The remaining runtime/model preparation can take a long
            # time or fail independently, and should not discard a token that the
            # user already supplied in the setup form.
            if req.type == "vyact" and huggingface_token:
                try:
                    await ensure_index()
                    token_config = await load_config_async()
                    token_config.setdefault("vyact_config", {})["huggingface_token"] = huggingface_token
                    await save_config_async(token_config)
                    saved_token_config = await load_config_async()
                    if saved_token_config.get("vyact_config", {}).get("huggingface_token") != huggingface_token:
                        raise RuntimeError("saved token could not be verified")
                    logger.info("[setup] Hugging Face token saved after ES initialization")
                except Exception as error:
                    logger.exception("[setup] Failed to save Hugging Face token")
                    yield sse(f"Hugging Face token save failed: {error}", "error", 0)
                    return

            async for event, should_continue in _stream_common_runtime(installer):
                yield event
                if not should_continue:
                    return

            # ES 인덱스 초기화
            try:
                from routers.skills import ensure_skills_index
                await ensure_index()
                await ensure_skills_index()
                await ensure_mcp_config()
                if req.type == "vyact":
                    vyact_config = cfg["vyact_config"]
                    from services.vyact_runtime import start_configured_runtime
                    model_id = await asyncio.to_thread(
                        start_configured_runtime, vyact_config, cfg.get("debug_logging", False),
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
    cfg = await load_config_async()
    if cfg.get("type") == "vyact":
        from services.mlx_runtime import list_downloaded_mlx_models, list_mtp_supported_mlx_models
        from services.vyact_runtime import get_active_mtp_model, list_mtp_supported_models, list_selectable_models
        installed_models = [*list_selectable_models(), *list_downloaded_mlx_models()]
        return {
            "models": [[model] for model in installed_models],
            "current": cfg.get("vyact_config", {}).get("model_path", ""),
            "installed": installed_models,
            "mtp_supported": [*list_mtp_supported_models(), *list_mtp_supported_mlx_models()],
            "mtp_active": get_active_mtp_model(),
            "model_type": "chat",
        }
    return {
        "models": [[cfg.get("model")]] if cfg.get("model") else [],
        "current": cfg.get("model", ""),
        "installed": [],
        "model_type": cfg.get("model_type", "chat"),
    }


@router.delete("/vyact/models/downloaded")
async def delete_vyact_model(req: VyactModelDeleteRequest):
    config = await load_config_async()
    current_model = str(config.get("vyact_config", {}).get("model_path") or "")
    if req.model_path == current_model:
        raise HTTPException(409, "현재 사용 중인 모델은 삭제할 수 없습니다.")
    try:
        if req.model_path.startswith("mlx/"):
            from services.mlx_runtime import delete_downloaded_mlx_model
            await asyncio.to_thread(delete_downloaded_mlx_model, req.model_path)
        else:
            from services.vyact_runtime import delete_downloaded_model
            await asyncio.to_thread(delete_downloaded_model, req.model_path)
    except (OSError, ValueError) as error:
        logger.warning("[vyact] model deletion failed: %s", error)
        raise HTTPException(400, "설치된 모델을 삭제할 수 없습니다.") from error
    await delete_model_profile(req.model_path)
    return {"deleted": True}


@router.get("/vyact/models/search")
async def search_vyact_models(q: str = Query("", max_length=200), mlx_only: bool = Query(False)):
    """Search MLX repositories on Apple Silicon, or GGUF repositories elsewhere."""
    try:
        from services.mlx_runtime import is_apple_silicon, list_downloaded_mlx_models, list_mtp_supported_mlx_models
        from services.vyact_runtime import list_downloaded_models, list_mtp_supported_models

        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")

        from services.huggingface_models import search_mlx_models

        use_mlx = mlx_only and is_apple_silicon()
        return {
            "models": await search_mlx_models(q, token) if use_mlx else await search_gguf_models(q, token),
            "hardware": get_local_hardware_info(),
            "installed": [*list_downloaded_models(), *list_downloaded_mlx_models()],
            "mtp_supported": [*list_mtp_supported_models(), *list_mtp_supported_mlx_models()],
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
        raise HTTPException(503, "모델 상세 정보 캐시를 조회할 수 없습니다.") from error


@router.get("/vyact/models/mlx-metadata")
async def get_vyact_mlx_model_metadata(
        repository: str = Query(..., min_length=3, max_length=256),
        revision: str = Query(..., min_length=1, max_length=128),
        file_size: int = Query(..., ge=1),
        context_size: int = Query(32768, ge=512, le=131072),
):
    try:
        from services.huggingface_models import inspect_mlx_model_metadata

        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")
        metadata = await inspect_mlx_model_metadata(
            repository, revision, file_size, context_size, token,
        )
        return {"metadata": metadata}
    except Exception as error:
        logger.warning("[vyact] MLX model metadata inspection failed: %s", error)
        raise HTTPException(502, "MLX 모델 상세 정보를 조회할 수 없습니다.") from error


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
        raise HTTPException(503, "모델 상세 정보를 저장할 수 없습니다.") from error


@router.post("/vyact/huggingface-token")
async def save_vyact_huggingface_token(req: HuggingFaceTokenRequest):
    config = await load_config_async()
    config.setdefault("vyact_config", {})["huggingface_token"] = req.token.strip()
    await save_config_async(config)
    return {"ok": True}


@router.get("/vyact/huggingface-token/status")
async def get_vyact_huggingface_token_status():
    """Expose only whether a token exists; never return the stored secret."""
    config = await load_config_async()
    token = config.get("vyact_config", {}).get("huggingface_token", "")
    return {"configured": bool(token.strip())}


@router.post("/vyact/runtime/install")
async def install_vyact_runtime():
    async def stream():
        from services.vyact_runtime import RuntimePackageManagerMissingError, install_missing_runtime

        try:
            async for message in install_missing_runtime():
                yield sse(message, "info")
        except RuntimePackageManagerMissingError:
            yield sse(
                "자동 설치에 필요한 패키지 관리자를 찾지 못했습니다.",
                "runtime_package_manager_missing",
                0,
            )
            return
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
        if req.runtime == "mlx":
            from services.mlx_runtime import associate_mlx_mtp_model, download_mlx_model

            config = await load_config_async()
            token = (req.token or "").strip() or config.get("vyact_config", {}).get("huggingface_token")
            yield sse(f"Downloading MLX {req.repository}", "log", None)
            loop = asyncio.get_running_loop()
            progress_queue: asyncio.Queue[int] = asyncio.Queue()
            downloaded_bytes = 0

            def report_downloaded_bytes(byte_delta: int) -> None:
                loop.call_soon_threadsafe(progress_queue.put_nowait, byte_delta)

            def download_mlx_with_optional_mtp():
                model_path = download_mlx_model(
                    req.repository, req.revision, token, report_downloaded_bytes,
                )
                if req.mtp_repository and req.mtp_revision:
                    mtp_path = download_mlx_model(
                        req.mtp_repository, req.mtp_revision, token, report_downloaded_bytes, "mtp",
                    )
                    associate_mlx_mtp_model(model_path, req.mtp_repository, mtp_path)

            download_task = asyncio.create_task(asyncio.to_thread(download_mlx_with_optional_mtp))
            try:
                while not download_task.done():
                    try:
                        byte_delta = await asyncio.wait_for(progress_queue.get(), timeout=0.25)
                    except asyncio.TimeoutError:
                        continue
                    downloaded_bytes += byte_delta
                    total_download_size = req.total_size_bytes + req.mtp_size_bytes
                    if total_download_size > 0:
                        progress = min(int(downloaded_bytes * 100 / total_download_size), 99)
                        yield sse(f"Downloading MLX {req.repository}", "log", progress)
                await download_task
            except Exception as error:
                logger.warning("[vyact] MLX model download failed: %s", error)
                yield sse(f"MLX 모델 다운로드 실패: {error}", "error", 0)
                return
            yield sse(f"{req.repository} 다운로드 완료", "ok", 100)
            return

        from services.huggingface_models import download_gguf_model, find_mtp_sidecar, find_vision_projector

        config = await load_config_async()
        token = (req.token or "").strip() or config.get("vyact_config", {}).get("huggingface_token")
        try:
            mtp_sidecar = await find_mtp_sidecar(req.repository, req.filename, token)
        except Exception as error:
            logger.info("[vyact] MTP sidecar discovery skipped: %s", error)
            mtp_sidecar = None
        try:
            vision_projector = await find_vision_projector(req.repository, req.filename, token)
        except Exception as error:
            logger.info("[vyact] vision projector discovery skipped: %s", error)
            vision_projector = None
        sidecars = [item for item in (mtp_sidecar, vision_projector) if item]
        model_progress_share = 80 if len(sidecars) == 2 else 90 if sidecars else 100
        try:
            async for downloaded, total in download_gguf_model(req.repository, req.filename, token):
                progress = int(downloaded * model_progress_share / total) if total else None
                yield sse(f"Downloading {req.filename}", "log", progress)
        except Exception as error:
            logger.warning("[vyact] GGUF download failed: %s", error)
            yield sse(f"모델 다운로드 실패: {error}", "error", 0)
            return
        sidecar_progress_share = (100 - model_progress_share) // len(sidecars) if sidecars else 0
        for sidecar_index, (sidecar_filename, _sidecar_size) in enumerate(sidecars):
            sidecar_type = "mtp_download" if mtp_sidecar and sidecar_filename == mtp_sidecar[0] else "vision_download"
            sidecar_label = "MTP" if sidecar_type == "mtp_download" else "vision projector"
            progress_start = model_progress_share + sidecar_index * sidecar_progress_share
            try:
                async for downloaded, total in download_gguf_model(req.repository, sidecar_filename, token):
                    progress = progress_start + int(downloaded * sidecar_progress_share / total) if total else None
                    yield sse(f"Downloading {sidecar_label} {sidecar_filename}", sidecar_type, progress)
            except Exception as error:
                if sidecar_type == "vision_download":
                    logger.warning("[vyact] vision projector download failed: %s", error)
                    yield sse(f"비전 projector 다운로드 실패: {error}", "error", progress_start)
                    return
                logger.info("[vyact] %s download skipped; using the main model: %s", sidecar_label, error)
        yield sse(f"{req.filename} 다운로드 완료", "ok", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


@router.get("/vyact/models/profile")
async def read_vyact_model_profile(
    model_path: str = Query(min_length=1, max_length=1024),
    runtime: str = Query(default="gguf", pattern="^(gguf|mlx)$"),
    repository: str | None = Query(default=None, max_length=256),
    recommended_context: int = Query(default=32768, ge=512, le=131072),
):
    profile = await get_model_profile(model_path)
    if profile is None:
        profile = recommended_model_profile(model_path, runtime, repository, recommended_context)
    elif "history_token_budget" not in profile:
        config = await load_config_async()
        profile = {
            **profile,
            "history_token_budget": config.get("runtime_settings", {}).get("history_token_budget", 16384),
        }
    profile = normalize_model_profile(profile)
    if runtime == "mlx":
        downloaded_model_path = get_downloaded_mlx_model_path(model_path)
        capabilities = await asyncio.to_thread(
            get_mlx_runtime_capabilities, downloaded_model_path,
        )
        capabilities["reasoning"] = await asyncio.to_thread(
            get_mlx_reasoning_capabilities,
            downloaded_model_path,
        )
    else:
        capabilities = {
            "performance_modes": ["auto", "memory", "performance"],
            "cpu_threads": True,
            "kv_cache_precisions": ["q8", "q4"],
            "seed": True,
            "reasoning": await asyncio.to_thread(
                get_gguf_reasoning_capabilities, get_downloaded_model_path(model_path),
            ),
        }
    return {**profile, "capabilities": capabilities}


@router.post("/vyact/models/profile")
async def write_vyact_model_profile(req: VyactModelProfileRequest):
    return await save_model_profile(req.model_dump())


@router.post("/vyact/models/activate")
async def activate_vyact_model(req: VyactModelActivateRequest):
    async def stream():
        yield sse("Vyact 모델을 메모리에 로드하는 중...", "model_loading", 10)
        try:
            config = await load_config_async()
            runtime = "mlx" if req.model_path.startswith("mlx/") else req.runtime
            safe_profile = normalize_model_profile({**req.model_dump(), "runtime": runtime})
            req.context_size = safe_profile["context_size"]
            req.max_output_tokens = safe_profile["max_output_tokens"]
            req.history_token_budget = safe_profile["history_token_budget"]
            if runtime == "mlx":
                from services.mlx_runtime import get_downloaded_mlx_model_path, start_mlx_model

                model_path = get_downloaded_mlx_model_path(req.model_path)
                model_id = await asyncio.to_thread(
                    start_mlx_model, model_path, req.context_size, config.get("debug_logging", False),
                    req.cache_quantization, req.mtp_enabled, req.kv_cache_precision,
                    req.performance_mode, req.cpu_threads,
                )
            else:
                from services.vyact_runtime import (
                    get_downloaded_model_path, get_loaded_context_size, start_single_model,
                )

                model_path = get_downloaded_model_path(req.model_path)
                model_id = await asyncio.to_thread(
                    start_single_model, model_path, req.context_size, config.get("debug_logging", False),
                    req.cache_quantization, req.mtp_enabled, req.kv_cache_precision,
                    req.performance_mode, req.cpu_threads,
                )
                req.context_size = await asyncio.to_thread(
                    get_loaded_context_size, model_id, req.context_size,
                )
            config["type"] = "vyact"
            config["model"] = model_id
            config["model_type"] = "chat"
            repository = req.repository
            if runtime == "mlx" and not repository:
                repository = req.model_path.removeprefix("mlx/")
            config.setdefault("vyact_config", {}).update({
                "model": model_id,
                "model_path": req.model_path,
                "context_size": req.context_size,
                "runtime": runtime,
                "repository": repository,
                "cache_quantization": req.cache_quantization,
                "mtp_enabled": req.mtp_enabled,
                "kv_cache_precision": safe_profile["kv_cache_precision"],
                "performance_mode": req.performance_mode, "cpu_threads": req.cpu_threads,
                "seed": req.seed,
                "max_output_tokens": req.max_output_tokens, "temperature": req.temperature,
                "history_token_budget": safe_profile["history_token_budget"],
                "top_k": req.top_k, "top_p": req.top_p,
            })
            await save_model_profile({
                "model_path": req.model_path, "runtime": runtime, "repository": repository,
                "context_size": req.context_size, "max_output_tokens": req.max_output_tokens,
                "history_token_budget": safe_profile["history_token_budget"],
                "temperature": req.temperature, "top_k": req.top_k, "top_p": req.top_p,
                "cache_quantization": req.cache_quantization,
                "mtp_enabled": req.mtp_enabled,
                "kv_cache_precision": safe_profile["kv_cache_precision"],
                "performance_mode": req.performance_mode, "cpu_threads": req.cpu_threads,
                "seed": req.seed,
            })
            common_settings = dict(config.get("runtime_settings", {}))
            config["runtime_settings"] = common_settings
            apply_runtime_settings({**common_settings, **_profile_runtime_settings(req.model_dump())})
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
        if req.type == "vyact":
            if not req.model:
                yield sse("Vyact 모델을 선택하세요.", "error", 0)
                return
            runtime = "mlx" if req.model.startswith("mlx/") else "gguf"
            repository = req.model.removeprefix("mlx/") if runtime == "mlx" else None
            profile = await get_model_profile(req.model)
            if profile is None:
                profile = await save_model_profile(recommended_model_profile(req.model, runtime, repository, 32768))
            vyact_config = config.setdefault("vyact_config", {})
            vyact_config.update({
                "model_path": req.model,
                "runtime": runtime,
                "repository": profile.get("repository") or repository,
                "context_size": profile["context_size"],
                "cache_quantization": profile["cache_quantization"],
                "mtp_enabled": profile.get("mtp_enabled"),
                "kv_cache_precision": profile.get("kv_cache_precision"),
                "performance_mode": profile.get("performance_mode", "auto"),
                "cpu_threads": profile.get("cpu_threads"), "seed": profile.get("seed"),
                "max_output_tokens": profile["max_output_tokens"], "temperature": profile["temperature"],
                "top_k": profile.get("top_k"), "top_p": profile.get("top_p"),
            })
            yield sse("모델 메모리 로드 중...", "model_loading", 20)
            try:
                from services.vyact_runtime import start_configured_runtime
                model_id = await asyncio.to_thread(
                    start_configured_runtime, vyact_config, config.get("debug_logging", False),
                )
            except Exception as error:
                yield sse(f"Vyact 모델 로드 실패: {error}", "error", 0)
                return
            config["type"] = "vyact"
            config["model"] = model_id
            config["model_type"] = "chat"
            vyact_config["model"] = model_id
            common_settings = dict(config.get("runtime_settings", {}))
            config["runtime_settings"] = common_settings
            apply_runtime_settings({**common_settings, **_profile_runtime_settings(profile)})
        elif req.type in ("openai", "gemini", "claude"):
            if not req.api_key:
                yield sse(f"{req.type.upper()} API KEY 필요", "error", 0)
                return
            config["type"] = req.type
            config["model"] = req.model
            config[f"{req.type}_config"] = {"api_key": req.api_key, "model": req.model}
        else:
            yield sse("지원하지 않는 provider", "error", 0)
            return
        await save_config_async(config)
        yield sse("설정 저장 완료", "done", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")

# ── Providers ────────────────────────────────
@router.get("/providers")
async def get_providers():
    config = await load_config_async()
    vyact_config = config.get("vyact_config", {})
    custom_providers = config.get("custom_providers", [])
    current_type = config.get("type", "vyact")
    supported_types = {"vyact", "openai", "gemini", "claude"}
    has_selected_custom_provider = (
        isinstance(current_type, str)
        and current_type.startswith("custom:")
        and any(
            current_type == f"custom:{item.get('id')}"
            for item in custom_providers
        )
    )
    # 이전 Ollama 등의 더 이상 지원하지 않는 provider 값이 남아 있으면 선택 UI는
    # options에서 해당 값을 찾지 못해 "선택"으로 표시된다. Vyact 모델이 이미
    # 설치된 경우에만 안전하게 Vyact로 복구해 다음 앱 시작에도 유지한다.
    if (
        current_type not in supported_types
        and not has_selected_custom_provider
        and vyact_config.get("model")
    ):
        current_type = "vyact"
        config["type"] = current_type
        config["model"] = vyact_config["model"]
        await save_config_async(config)
        logger.info("[providers] restored Vyact as the selected provider")
    providers = {}
    for p in ["openai", "gemini", "claude"]:
        pc = config.get(f"{p}_config")
        if pc:
            key = pc.get("api_key", "")
            providers[p] = {
                "model": pc.get("model"),
                "history_token_budget": pc.get("history_token_budget", 16384),
                "temperature": pc.get("temperature", 0.2),
                "max_output_tokens": pc.get("max_output_tokens", 2048),
                "has_key": bool(key),
                "key_preview": f"{key[:8]}..." if len(key) > 8 else "",
            }
    providers["vyact"] = {
        "model": vyact_config.get("model"),
        "has_key": bool(vyact_config.get("model")),
    }
    return {
        "current_type": current_type,
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
            for item in custom_providers
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
        vyact_config = config.get("vyact_config", {})
        config["type"] = "vyact"
        config["model"] = vyact_config.get("model", "")
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
        config[f"{provider}_config"] = {
            "api_key": api_key,
            "model": req.model.strip(),
            "history_token_budget": req.history_token_budget,
            "temperature": req.temperature,
            "max_output_tokens": req.max_output_tokens,
        }
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
    if req.provider == "vyact":
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
    previous_enabled = bool(cfg.get("debug_logging", cfg.get("tool_debug_logging", False)))
    enabled = bool(body.get("enabled", False))
    cfg["debug_logging"] = enabled
    cfg.pop("tool_debug_logging", None)
    await save_config_async(cfg)
    DebugLogSettings.set_enabled(enabled)

    vyact_config = cfg.get("vyact_config", {})
    model_path_value = vyact_config.get("model_path")
    if cfg.get("type") != "vyact" or not model_path_value or enabled == previous_enabled:
        return {"debug_logging": enabled, "runtime_restarted": False}

    try:
        if vyact_config.get("runtime", "gguf") == "mlx":
            from services.mlx_runtime import get_downloaded_mlx_model_path, start_mlx_model
            model_path = get_downloaded_mlx_model_path(model_path_value)
            start_model = start_mlx_model
        else:
            from services.vyact_runtime import get_downloaded_model_path, start_single_model
            model_path = get_downloaded_model_path(model_path_value)
            start_model = start_single_model
        model_id = await asyncio.to_thread(
            start_model, model_path, vyact_config.get("context_size", 32768), enabled,
            vyact_config.get("cache_quantization", True), vyact_config.get("mtp_enabled"),
            vyact_config.get("kv_cache_precision"), vyact_config.get("performance_mode", "auto"),
            vyact_config.get("cpu_threads"),
        )
        cfg["model"] = model_id
        cfg.setdefault("vyact_config", {})["model"] = model_id
        await save_config_async(cfg)
    except Exception as error:
        logger.warning("[vyact] debug logging restart failed: %s", error)
        cfg["debug_logging"] = previous_enabled
        await save_config_async(cfg)
        DebugLogSettings.set_enabled(previous_enabled)
        try:
            await asyncio.to_thread(
                start_model, model_path, vyact_config.get("context_size", 32768), previous_enabled,
                vyact_config.get("cache_quantization", True), vyact_config.get("mtp_enabled"),
                vyact_config.get("kv_cache_precision"), vyact_config.get("performance_mode", "auto"),
                vyact_config.get("cpu_threads"),
            )
        except Exception as restore_error:
            logger.error("[vyact] failed to restore runtime after debug restart: %s", restore_error)
        raise HTTPException(500, "Vyact 런타임을 다시 시작하지 못했습니다.") from error

    return {"debug_logging": enabled, "runtime_restarted": True}


@router.get("/settings/runtime")
async def get_runtime_settings_endpoint():
    cfg = await load_config_async()
    values = {**DEFAULT_RUNTIME_SETTINGS, **dict(cfg.get("runtime_settings", {}))}
    return {key: values[key] for key in RUNTIME_SETTING_LIMITS}


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
    values = {key: value for key, value in values.items() if key in RUNTIME_SETTING_LIMITS}
    common_settings = {key: value for key, value in {**cfg.get("runtime_settings", {}), **values}.items() if key in RUNTIME_SETTING_LIMITS}
    cfg["runtime_settings"] = common_settings
    merged = {**DEFAULT_RUNTIME_SETTINGS, **common_settings}
    vyact_config = cfg.get("vyact_config", {})
    if cfg.get("type") == "vyact" and vyact_config.get("model_path"):
        merged.update(_profile_runtime_settings(vyact_config))
    apply_runtime_settings(merged)
    await save_config_async(cfg)
    return {key: merged[key] for key in RUNTIME_SETTING_LIMITS}


# ─────────────────────────────
# TTS 설정
# ─────────────────────────────
@router.get("/settings/tts")
async def get_tts_settings():
    cfg = await load_config_async()
    return {
        "rate": cfg.get("tts_rate", 1.0),
        "volume": cfg.get("tts_volume", 1.0),
        "enVoiceURI": cfg.get("tts_en_voice_uri", ""),
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
