"""
routers/setup.py – 설치 / 모델 / Provider / 상태
"""
import asyncio
import copy
import json
import uuid
import urllib.error
import urllib.request
from urllib.parse import urlparse
import math
import os
import platform
import re
import secrets
import socket
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from agent import ensure_index, get_index_stats, load_prompts_cache
from config import INSTALL_DIR, LOGS_DIR, SETUP_DONE, VENV_DIR, get_log_file
from routers.deps import APP_DIR, load_config_async, load_ui_language_async, save_config_async, sse, write_log
from logger import DebugLogSettings, ToolLogSettings, get_logger
from services.installer import is_docker_available, Installer
from services.llm.errors import is_insufficient_memory_message
from services.es_native import is_native_supported
from services.hardware_info import get_local_hardware_info, validate_gpu_split_percentages
from services.huggingface_models import (
    MODEL_SEARCH_RESULT_LIMIT, enrich_model_file_sizes, get_model_file_size,
    search_gguf_models, search_mlx_models,
)
from services.db import get_es, SETTINGS_INDEX
from services.mcp_config import ensure_mcp_config
from services.runtime_settings import DEFAULT_RUNTIME_SETTINGS, apply_runtime_settings
from services.runtime_startup import (
    apply_startup_runtime_choice, get_startup_runtime_state, runtime_load_error_code,
    warm_loaded_vyact_model,
)
from services.model_runtime_profiles import delete_model_profile, get_model_profile, normalize_gpu_split_for_hardware, normalize_model_profile, recommended_model_profile, save_model_profile
from services.model_memory import estimate_downloaded_model_memory_bytes
from services.vyact_model_metadata_cache import get_cached_model_metadata, save_cached_model_metadata
from services.mlx_runtime import get_downloaded_mlx_model_path, get_mlx_runtime_capabilities, is_apple_silicon, list_multimodal_supported_mlx_models
from services.external_api_server import EXTERNAL_API_PORT, public_model_id
from services.reasoning_capabilities import get_gguf_reasoning_capabilities, get_mlx_reasoning_capabilities
from services.vyact_runtime import VYACT_RUNTIME_URL, get_downloaded_model_path, get_model_modalities

logger = get_logger(__name__)

async def _recommended_local_context(model_path: str, runtime: str, fallback: int = 32768) -> int:
    return max(512, int(fallback))


async def _get_or_create_model_profile(
    model_path: str,
    runtime: str,
    repository: str | None,
    fallback_context: int = 32768,
    persist: bool = False,
) -> dict:
    profile = await get_model_profile(model_path)
    if profile is not None:
        return profile
    recommended_context = await _recommended_local_context(model_path, runtime, fallback_context)
    profile = recommended_model_profile(model_path, runtime, repository, recommended_context)
    return await save_model_profile(profile) if persist else profile


def _apply_model_profile(vyact_config: dict, profile: dict) -> None:
    vyact_config.update({
        "repository": profile.get("repository") or vyact_config.get("repository"),
        "context_size": profile["context_size"],
        "cache_quantization": profile["cache_quantization"],
        "mtp_enabled": profile.get("mtp_enabled"),
        "kv_cache_precision": profile.get("kv_cache_precision"),
        "performance_mode": profile.get("performance_mode", "auto"),
        "cpu_threads": profile.get("cpu_threads"),
        "seed": profile.get("seed"),
        "max_output_tokens": profile["max_output_tokens"],
        "history_token_budget": profile["history_token_budget"],
        "temperature": profile["temperature"],
        "top_k": profile.get("top_k"),
        "top_p": profile.get("top_p"),
    })

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
    specprefill_repository: str | None = Field(default=None, min_length=3, max_length=256)
    specprefill_revision: str | None = Field(default=None, min_length=1, max_length=128)
    specprefill_size_bytes: int = Field(default=0, ge=0)
    dflash2_repository: str | None = Field(default=None, min_length=3, max_length=256)
    dflash2_revision: str | None = Field(default=None, min_length=1, max_length=128)
    dflash2_filename: str | None = Field(default=None, min_length=6, max_length=1024)
    dflash2_size_bytes: int = Field(default=0, ge=0)
    dflash2_bundled: bool = False


class VyactModelActivateRequest(BaseModel):
    model_path: str = Field(min_length=6, max_length=1024)
    context_size: int = Field(default=32768, ge=512)
    runtime: str = Field(default="gguf", pattern="^(gguf|mlx)$")
    repository: str | None = Field(default=None, min_length=3, max_length=256)
    max_output_tokens: int = Field(default=4096, ge=1, le=32768)
    history_token_budget: int = Field(default=16384, ge=0)
    temperature: float = Field(default=0.2, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=100)
    top_p: float | None = Field(default=None, ge=0, le=1)
    cache_quantization: bool = True
    mtp_enabled: bool | None = None
    mtp_failure_code: str | None = Field(default=None, pattern="^(load_failed|out_of_memory)$")
    mtp_failure_message: str | None = Field(default=None, max_length=500)
    mtp_failed_at: str | None = Field(default=None, max_length=64)
    kv_cache_precision: str | None = Field(default=None, pattern="^(none|q8|q4)$")
    performance_mode: str = Field(default="auto", pattern="^(auto|memory|performance)$")
    cpu_threads: int | None = Field(default=None, ge=1, le=256)
    gpu_split_percentages: list[float] = Field(default_factory=list, max_length=16)
    gpu_manual_split_enabled: bool = False
    seed: int | None = Field(default=None, ge=0, le=2147483647)

class VyactModelProfileRequest(BaseModel):
    model_path: str = Field(min_length=1, max_length=1024)
    runtime: str = Field(default="gguf", pattern="^(gguf|mlx)$")
    repository: str | None = Field(default=None, max_length=256)
    context_size: int = Field(default=32768, ge=512)
    max_output_tokens: int = Field(default=4096, ge=1, le=32768)
    history_token_budget: int = Field(default=16384, ge=0)
    temperature: float = Field(default=0.2, ge=0, le=1)
    top_k: int | None = Field(default=None, ge=0, le=100)
    top_p: float | None = Field(default=None, ge=0, le=1)
    cache_quantization: bool = True
    mtp_enabled: bool | None = None
    mtp_failure_code: str | None = Field(default=None, pattern="^(load_failed|out_of_memory)$")
    mtp_failure_message: str | None = Field(default=None, max_length=500)
    mtp_failed_at: str | None = Field(default=None, max_length=64)
    kv_cache_precision: str | None = Field(default=None, pattern="^(none|q8|q4)$")
    performance_mode: str = Field(default="auto", pattern="^(auto|memory|performance)$")
    cpu_threads: int | None = Field(default=None, ge=1, le=256)
    gpu_split_percentages: list[float] = Field(default_factory=list, max_length=16)
    gpu_manual_split_enabled: bool = False
    seed: int | None = Field(default=None, ge=0, le=2147483647)

class VyactModelDeleteRequest(BaseModel):
    model_path: str = Field(min_length=1, max_length=1024)


class ExternalApiAuthRequest(BaseModel):
    enabled: bool


class VyactModelMetadataRequest(BaseModel):
    repository: str = Field(min_length=3, max_length=256)
    filename: str = Field(min_length=6, max_length=1024)
    revision: str = Field(min_length=1, max_length=128)
    context_size: int = Field(default=32768, ge=512)
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
    hardware = get_local_hardware_info()
    ram_gb = max(1, int(hardware["system_memory"]["total_bytes"]) // (1024 ** 3))
    return {
        "setup_done": SETUP_DONE.exists(),
        "config": await load_config_async(),
        "ram_gb": ram_gb,
        "cpu_cores": str(os.cpu_count() or 1),
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

    async def _prepare_common_runtime(
        installer: Installer,
        huggingface_token: str | None = None,
    ):
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
        ok, msg = await installer.download_kokoro_model(huggingface_token)
        if not ok:
            yield msg, "error", 0, False
            return
        yield msg, "ok", 94, True

        yield "Warming up Kokoro TTS...", "info", 94, True
        from main import warmup_kokoro_tts
        tts_ready = await warmup_kokoro_tts(huggingface_token)
        yield (
            "Kokoro TTS ready" if tts_ready else "Kokoro TTS warm-up skipped",
            "ok" if tts_ready else "log",
            95,
            True,
        )

    async def _stream_common_runtime(
        installer: Installer,
        huggingface_token: str | None = None,
    ):
        async for message, level, progress, should_continue in _prepare_common_runtime(
            installer, huggingface_token,
        ):
            yield sse(message, level, progress), should_continue

    async def stream():
        request_config = req.config or {}
        persisted_setup_config = {"es_mode": request_config.get("es_mode", "docker")}
        if req.type == "vyact":
            if not req.model:
                yield sse("Vyact 모델을 먼저 다운로드하고 선택하세요.", "error", 0)
                return
            requested_runtime = request_config.get("runtime", "mlx" if req.model.startswith("mlx/") else "gguf")
            if requested_runtime == "mlx" and not is_apple_silicon():
                yield sse("mlx_unsupported_platform", "error", 0)
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
                    "model_path": request_config.get("model_path") or vyact_config.get("model_path") or req.model,
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
                    yield sse("Native ES is supported on Windows x64, Apple Silicon Mac, and Linux x64. Please select Docker.", "error", 0)
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

            async for event, should_continue in _stream_common_runtime(
                installer,
                huggingface_token if req.type == "vyact" else None,
            ):
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
                    profile = await _get_or_create_model_profile(
                        vyact_config["model_path"],
                        vyact_config.get("runtime", "gguf"),
                        vyact_config.get("repository"),
                        int(vyact_config.get("context_size") or 32768),
                        persist=True,
                    )
                    _apply_model_profile(vyact_config, profile)
                    from services.vyact_runtime import start_configured_runtime
                    model_id = await asyncio.to_thread(
                        start_configured_runtime, vyact_config, cfg.get("debug_logging", False),
                    )
                    cfg["model"] = model_id
                    cfg["vyact_config"]["model"] = model_id
                await save_config_async(cfg)
                await load_prompts_cache()
                if req.type == "vyact":
                    await warm_loaded_vyact_model(
                        model_id, await load_ui_language_async() or "",
                    )
                logger.info("[setup] LLM connection config saved after ES initialization")
            except Exception as e:
                logger.exception("[setup] Cloud setup init failed")
                if req.type == "vyact" and runtime_load_error_code(e) == "model_insufficient_memory":
                    yield sse(
                        "The selected model does not fit in currently available memory.",
                        "error", 0,
                        "main:message.modelInsufficientMemoryDescription",
                        {"model": cfg.get("model") or cfg.get("vyact_config", {}).get("model_path", "")},
                    )
                    return
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
        from services.mlx_runtime import get_active_dflash2_mlx_model, list_dflash2_supported_mlx_models, list_downloaded_mlx_models, list_mtp_supported_mlx_models
        from services.vyact_runtime import get_active_dflash2_model, get_active_mtp_model, list_dflash2_supported_models, list_mtp_supported_models, list_multimodal_supported_models, list_selectable_models
        mlx_available = is_apple_silicon()
        current_model = cfg.get("vyact_config", {}).get("model_path", "")
        if not mlx_available and current_model.startswith("mlx/"):
            current_model = ""
        installed_models = [
            *list_selectable_models(),
            *(list_downloaded_mlx_models() if mlx_available else []),
        ]
        multimodal_models = await asyncio.to_thread(list_multimodal_supported_models)
        if mlx_available:
            mlx_modalities = await asyncio.to_thread(list_multimodal_supported_mlx_models)
            for modality in multimodal_models:
                multimodal_models[modality].extend(mlx_modalities[modality])
        return {
            "models": [[model] for model in installed_models],
            "current": current_model,
            "installed": installed_models,
            "mtp_supported": [
                *list_mtp_supported_models(),
                *(list_mtp_supported_mlx_models() if mlx_available else []),
            ],
            "mtp_active": get_active_mtp_model(),
            "dflash2_supported": [
                *list_dflash2_supported_models(),
                *(list_dflash2_supported_mlx_models() if mlx_available else []),
            ],
            "dflash2_active": (get_active_dflash2_mlx_model() if mlx_available else None) or get_active_dflash2_model(),
            "vision_supported": multimodal_models["image"],
            "audio_supported": multimodal_models["audio"],
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
    """Search all compatible repositories, or only MLX when explicitly requested."""
    try:
        from services.mlx_runtime import list_dflash2_supported_mlx_models, list_downloaded_mlx_models, list_mtp_supported_mlx_models
        from services.vyact_runtime import list_dflash2_supported_models, list_downloaded_models, list_mtp_supported_models

        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")

        mlx_available = is_apple_silicon()
        if mlx_only and mlx_available:
            models = await search_mlx_models(q, token)
        elif mlx_available:
            gguf_models, mlx_models = await asyncio.gather(
                search_gguf_models(q, token),
                search_mlx_models(q, token),
            )
            models = sorted(
                [*gguf_models, *mlx_models], key=lambda model: model["downloads"], reverse=True,
            )[:MODEL_SEARCH_RESULT_LIMIT]
        else:
            models = await search_gguf_models(q, token)
        models = await enrich_model_file_sizes(models[:MODEL_SEARCH_RESULT_LIMIT], token)
        return {
            "models": models,
            "hardware": get_local_hardware_info(),
            "installed": [
                *list_downloaded_models(),
                *(list_downloaded_mlx_models() if mlx_available else []),
            ],
            "mtp_supported": [
                *list_mtp_supported_models(),
                *(list_mtp_supported_mlx_models() if mlx_available else []),
            ],
            "dflash2_supported": [
                *list_dflash2_supported_models(),
                *(list_dflash2_supported_mlx_models() if mlx_available else []),
            ],
        }
    except Exception as error:
        logger.warning("[vyact] Hugging Face search failed: %s", error)
        raise HTTPException(502, "Hugging Face 모델 검색에 실패했습니다.") from error


@router.get("/vyact/models/metadata-cache")
async def get_vyact_model_metadata_cache(
        repository: str = Query(..., min_length=3, max_length=256),
        filename: str = Query(..., min_length=6, max_length=1024),
        revision: str = Query(..., min_length=1, max_length=128),
        context_size: int = Query(32768, ge=512),
):
    try:
        metadata = await get_cached_model_metadata(repository, filename, revision, context_size)
        return {"metadata": metadata}
    except Exception as error:
        logger.warning("[vyact] Model metadata cache lookup failed: %s", error)
        raise HTTPException(503, "모델 상세 정보 캐시를 조회할 수 없습니다.") from error


@router.get("/vyact/models/file-size")
async def get_vyact_model_file_size(
        repository: str = Query(..., min_length=3, max_length=256),
        filename: str = Query(..., min_length=1, max_length=1024),
        runtime: str = Query(..., pattern="^(gguf|mlx)$"),
):
    try:
        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")
        size = await get_model_file_size(repository, filename, runtime, token)
        return {"file_size": size}
    except Exception as error:
        logger.warning("[vyact] Model file size lookup failed: %s", error)
        raise HTTPException(502, "모델 파일 크기를 조회할 수 없습니다.") from error


@router.get("/vyact/models/mlx-metadata")
async def get_vyact_mlx_model_metadata(
        repository: str = Query(..., min_length=3, max_length=256),
        revision: str = Query(..., min_length=1, max_length=128),
        file_size: int = Query(..., ge=1),
        context_size: int = Query(32768, ge=512),
):
    if not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")
    try:
        from services.huggingface_models import inspect_mlx_model_metadata

        config = await load_config_async()
        token = config.get("vyact_config", {}).get("huggingface_token")
        details = await inspect_mlx_model_metadata(
            repository, revision, file_size, context_size, token,
        )
        return details
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
async def install_vyact_runtime(include_omlx: bool = Query(False)):
    if include_omlx and not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")

    async def stream():
        from services.vyact_runtime import RuntimePackageManagerMissingError, install_missing_runtime

        try:
            if include_omlx:
                from services.mlx_runtime import install_missing_omlx_runtime
                async for message in install_missing_omlx_runtime():
                    yield sse(message, "info")
            else:
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
        from services.runtime_startup import get_runtime_update_commands

        commands = get_runtime_update_commands(await load_config_async())
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


@router.get("/vyact/runtime/startup-status")
async def get_vyact_runtime_startup_status():
    return get_startup_runtime_state()


@router.get("/vyact/external-api/status")
async def get_vyact_external_api_status():
    """Return the network-facing Vyact gateway and active runtime status."""
    config = await load_config_async()
    vyact_config = config.get("vyact_config", {})
    configured_model_id = str(vyact_config.get("model") or config.get("model") or "")
    context_window = int(vyact_config.get("context_size") or 32768)
    max_tokens = int(vyact_config.get("max_output_tokens") or 2048)

    def fetch_runtime_models() -> list[str]:
        try:
            with urllib.request.urlopen(f"{VYACT_RUNTIME_URL}/models", timeout=2) as response:
                payload = json.load(response)
        except (OSError, ValueError, urllib.error.URLError):
            return []
        if not isinstance(payload, dict):
            return []
        return [
            str(item["id"])
            for item in payload.get("data", [])
            if isinstance(item, dict) and item.get("id")
        ]

    model_ids = await asyncio.to_thread(fetch_runtime_models)
    active_model_id = configured_model_id if configured_model_id in model_ids else None
    external_api = config.get("external_api", {})
    local_endpoint = f"http://127.0.0.1:{EXTERNAL_API_PORT}/v1"

    def get_lan_address() -> str | None:
        sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        try:
            sock.connect(("192.0.2.1", 80))
            address = sock.getsockname()[0]
            return address if address and not address.startswith("127.") else None
        except OSError:
            return None
        finally:
            sock.close()

    lan_address = await asyncio.to_thread(get_lan_address)
    return {
        "endpoint": local_endpoint,
        "network_endpoint": f"http://{lan_address}:{EXTERNAL_API_PORT}/v1" if lan_address else None,
        "available": active_model_id is not None,
        "model_id": public_model_id(config) if active_model_id else None,
        "context_window": context_window,
        "max_tokens": max_tokens,
        "network_scope": "lan",
        "auth_enabled": bool(external_api.get("auth_enabled")),
        "api_token": external_api.get("api_token"),
    }


@router.post("/vyact/external-api/auth")
async def update_vyact_external_api_auth(req: ExternalApiAuthRequest):
    config = await load_config_async()
    settings = config.setdefault("external_api", {})
    settings["auth_enabled"] = req.enabled
    if req.enabled and not settings.get("api_token"):
        settings["api_token"] = secrets.token_urlsafe(32)
    await save_config_async(config)
    return {"auth_enabled": req.enabled, "api_token": settings.get("api_token")}


@router.post("/vyact/external-api/token/regenerate")
async def regenerate_vyact_external_api_token():
    config = await load_config_async()
    settings = config.setdefault("external_api", {})
    if not settings.get("auth_enabled"):
        raise HTTPException(409, "external_api_auth_disabled")
    settings["api_token"] = secrets.token_urlsafe(32)
    await save_config_async(config)
    return {"auth_enabled": True, "api_token": settings["api_token"]}


@router.post("/vyact/runtime/startup-choice")
async def choose_vyact_runtime_startup(body: dict):
    try:
        await apply_startup_runtime_choice(bool(body.get("update")))
        return {"status": "ready"}
    except Exception as error:
        logger.warning("[runtime_update] startup choice failed: %s", error)
        raise HTTPException(500, str(error)) from error


@router.post("/vyact/models/download")
async def download_vyact_model(req: HuggingFaceDownloadRequest):
    if req.runtime == "mlx" and not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")

    async def stream():
        if req.runtime == "mlx":
            from services.mlx_runtime import associate_mlx_bundled_dflash2_model, associate_mlx_dflash2_model, associate_mlx_mtp_model, download_mlx_model, get_mlx_downloaded_bytes

            config = await load_config_async()
            token = (req.token or "").strip() or config.get("vyact_config", {}).get("huggingface_token")
            main_download_size = req.total_size_bytes
            if main_download_size <= 0:
                try:
                    main_download_size = await get_model_file_size(
                        req.repository, req.filename, "mlx", token,
                    )
                except Exception as error:
                    logger.warning("[vyact] MLX model size lookup failed: %s", error)
            yield sse(f"Downloading MLX {req.repository}", "log", None)

            def download_mlx_with_optional_mtp():
                model_path = download_mlx_model(
                    req.repository, req.revision, token,
                )
                if req.dflash2_bundled:
                    associate_mlx_bundled_dflash2_model(model_path)
                if not req.dflash2_repository and req.mtp_repository and req.mtp_revision:
                    mtp_path = download_mlx_model(
                        req.mtp_repository, req.mtp_revision, token, role="mtp",
                    )
                    associate_mlx_mtp_model(model_path, req.mtp_repository, mtp_path)
                if req.dflash2_repository and req.dflash2_revision:
                    dflash2_path = download_mlx_model(
                        req.dflash2_repository, req.dflash2_revision, token, role="dflash2",
                    )
                    associate_mlx_dflash2_model(model_path, req.dflash2_repository, dflash2_path)

            download_task = asyncio.create_task(asyncio.to_thread(download_mlx_with_optional_mtp))
            try:
                download_repositories = [req.repository]
                if not req.dflash2_repository and req.mtp_repository:
                    download_repositories.append(req.mtp_repository)
                if req.dflash2_repository:
                    download_repositories.append(req.dflash2_repository)
                total_download_size = (
                    main_download_size + req.mtp_size_bytes + req.dflash2_size_bytes
                )
                last_progress = -1
                while not download_task.done():
                    await asyncio.sleep(0.25)
                    if total_download_size > 0:
                        downloaded_bytes = sum(
                            await asyncio.gather(*[
                                asyncio.to_thread(get_mlx_downloaded_bytes, repository)
                                for repository in download_repositories
                            ])
                        )
                        progress = min(int(downloaded_bytes * 100 / total_download_size), 99)
                        if progress != last_progress:
                            last_progress = progress
                            yield sse(f"Downloading MLX {req.repository}", "log", progress)
                await download_task
            except Exception as error:
                logger.warning("[vyact] MLX model download failed: %s", error)
                yield sse(f"MLX 모델 다운로드 실패: {error}", "error", 0)
                return
            yield sse(f"{req.repository} 다운로드 완료", "ok", 100)
            return

        from services.huggingface_models import download_gguf_model, find_mtp_sidecar, find_vision_projector
        from services.vyact_runtime import VYACT_MODELS_DIR, associate_dflash2_model

        config = await load_config_async()
        token = (req.token or "").strip() or config.get("vyact_config", {}).get("huggingface_token")
        try:
            mtp_sidecar = None if req.dflash2_repository else await find_mtp_sidecar(req.repository, req.filename, token)
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
        if req.dflash2_repository and req.dflash2_revision and req.dflash2_filename:
            try:
                async for downloaded, total in download_gguf_model(
                    req.dflash2_repository, req.dflash2_filename, token,
                ):
                    progress = 90 + int(downloaded * 10 / total) if total else None
                    yield sse(f"Downloading DFlash2 {req.dflash2_filename}", "dflash2_download", progress)
                main_path = VYACT_MODELS_DIR / req.repository / req.filename
                dflash2_path = VYACT_MODELS_DIR / req.dflash2_repository / req.dflash2_filename
                associate_dflash2_model(main_path, dflash2_path)
            except Exception as error:
                logger.info("[vyact] DFlash2 download skipped; using the main model: %s", error)
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
    recommended_context: int = Query(default=32768, ge=512),
):
    if runtime == "mlx" and not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")
    try:
        profile = await _get_or_create_model_profile(
            model_path, runtime, repository, recommended_context,
        )
    except ValueError as error:
        raise HTTPException(404, "local_model_not_downloaded") from error
    if "history_token_budget" not in profile:
        config = await load_config_async()
        profile = {
            **profile,
            "history_token_budget": config.get("runtime_settings", {}).get("history_token_budget", 16384),
        }
    profile = normalize_model_profile(profile)
    try:
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
            downloaded_model_path = get_downloaded_model_path(model_path)
            hardware = get_local_hardware_info()
            profile = normalize_gpu_split_for_hardware(profile, hardware)
            capabilities = {
                "performance_modes": ["auto", "memory", "performance"],
                "cpu_threads": True,
                "kv_cache_precisions": ["q8", "q4"],
                "seed": True,
                "reasoning": await asyncio.to_thread(
                    get_gguf_reasoning_capabilities, downloaded_model_path,
                ),
                "modalities": await asyncio.to_thread(
                    get_model_modalities, downloaded_model_path,
                ),
                "hardware": hardware,
            }
    except ValueError as error:
        raise HTTPException(404, "local_model_not_downloaded") from error
    return {
        **profile,
        "estimated_memory_bytes": estimate_downloaded_model_memory_bytes(
            downloaded_model_path,
            runtime,
            profile["context_size"],
            profile.get("kv_cache_precision") or "none",
        ),
        "capabilities": capabilities,
    }


@router.post("/vyact/models/profile")
async def write_vyact_model_profile(req: VyactModelProfileRequest):
    if req.runtime == "mlx" and not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")
    profile = req.model_dump()
    profile["gpu_split_percentages"] = validate_gpu_split_percentages(
        profile["gpu_split_percentages"], get_local_hardware_info(),
    ) if req.runtime == "gguf" else []
    if profile["gpu_manual_split_enabled"] and not profile["gpu_split_percentages"]:
        raise HTTPException(400, "invalid_gpu_split_percentages")
    return await save_model_profile(profile)


@router.post("/vyact/models/activate")
async def activate_vyact_model(req: VyactModelActivateRequest):
    if (req.runtime == "mlx" or req.model_path.startswith("mlx/")) and not is_apple_silicon():
        raise HTTPException(400, "mlx_unsupported_platform")

    async def stream():
        yield sse("Vyact 모델을 메모리에 로드하는 중...", "model_loading", 10)
        try:
            config = await load_config_async()
            runtime = "mlx" if req.model_path.startswith("mlx/") else req.runtime
            request_profile = req.model_dump()
            request_profile["gpu_split_percentages"] = validate_gpu_split_percentages(
                request_profile["gpu_split_percentages"], get_local_hardware_info(),
            ) if runtime == "gguf" else []
            if request_profile["gpu_manual_split_enabled"] and not request_profile["gpu_split_percentages"]:
                raise ValueError("invalid_gpu_split_percentages")
            safe_profile = normalize_model_profile({**request_profile, "runtime": runtime})
            req.context_size = safe_profile["context_size"]
            req.max_output_tokens = safe_profile["max_output_tokens"]
            req.history_token_budget = safe_profile["history_token_budget"]
            runtime_status: dict = {}
            if runtime == "mlx":
                from services.mlx_runtime import get_downloaded_mlx_model_path, start_mlx_model

                model_path = get_downloaded_mlx_model_path(req.model_path)
                model_id = await asyncio.to_thread(
                    start_mlx_model, model_path, req.context_size, config.get("debug_logging", False),
                    req.cache_quantization, req.mtp_enabled, req.kv_cache_precision,
                    req.performance_mode, req.cpu_threads, runtime_status,
                )
            else:
                from services.vyact_runtime import (
                    get_downloaded_model_path, get_loaded_context_size, start_single_model,
                )

                model_path = get_downloaded_model_path(req.model_path)
                model_id = await asyncio.to_thread(
                    start_single_model, model_path, req.context_size, config.get("debug_logging", False),
                    req.cache_quantization, req.mtp_enabled, req.kv_cache_precision,
                    req.performance_mode, req.cpu_threads, safe_profile["gpu_split_percentages"],
                    safe_profile["gpu_manual_split_enabled"],
                    runtime_status,
                )
                req.context_size = await asyncio.to_thread(
                    get_loaded_context_size, model_id, req.context_size,
                )
            mtp_fallback = runtime_status.get("mtp_fallback", False)
            effective_mtp_enabled = False if mtp_fallback else req.mtp_enabled
            mtp_failure_code = runtime_status.get("mtp_failure_code") if mtp_fallback else None
            mtp_failure_message = runtime_status.get("mtp_failure_message") if mtp_fallback else None
            mtp_failed_at = datetime.now(timezone.utc).isoformat() if mtp_fallback else None
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
                "mtp_enabled": effective_mtp_enabled,
                "mtp_failure_code": mtp_failure_code,
                "mtp_failure_message": mtp_failure_message,
                "mtp_failed_at": mtp_failed_at,
                "kv_cache_precision": safe_profile["kv_cache_precision"],
                "performance_mode": req.performance_mode, "cpu_threads": req.cpu_threads,
                "gpu_split_percentages": safe_profile["gpu_split_percentages"],
                "gpu_manual_split_enabled": safe_profile["gpu_manual_split_enabled"],
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
                "mtp_enabled": effective_mtp_enabled,
                "mtp_failure_code": mtp_failure_code,
                "mtp_failure_message": mtp_failure_message,
                "mtp_failed_at": mtp_failed_at,
                "kv_cache_precision": safe_profile["kv_cache_precision"],
                "performance_mode": req.performance_mode, "cpu_threads": req.cpu_threads,
                "gpu_split_percentages": safe_profile["gpu_split_percentages"],
                "gpu_manual_split_enabled": safe_profile["gpu_manual_split_enabled"],
                "seed": req.seed,
            })
            common_settings = dict(config.get("runtime_settings", {}))
            config["runtime_settings"] = common_settings
            apply_runtime_settings({**common_settings, **_profile_runtime_settings(req.model_dump())})
            await warm_loaded_vyact_model(
                model_id, await load_ui_language_async() or "", runtime,
            )
            await save_config_async(config)
        except Exception as error:
            logger.warning("[vyact] model activation failed: %s", error)
            diagnostic = getattr(error, "diagnostic", "")
            is_insufficient_memory = is_insufficient_memory_message(error) or is_insufficient_memory_message(diagnostic)
            message = "model_insufficient_memory" if is_insufficient_memory else f"Vyact 모델 로드 실패: {error}"
            yield sse(message, "error", 0)
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
            if runtime == "mlx" and not is_apple_silicon():
                yield sse("mlx_unsupported_platform", "error", 0)
                return
            repository = req.model.removeprefix("mlx/") if runtime == "mlx" else None
            profile = await _get_or_create_model_profile(
                req.model, runtime, repository, persist=True,
            )
            previous_config = copy.deepcopy(config)
            vyact_config = config.setdefault("vyact_config", {})
            vyact_config.update({
                "model_path": req.model,
                "runtime": runtime,
            })
            _apply_model_profile(vyact_config, profile)
            yield sse("모델 메모리 로드 중...", "model_loading", 20)
            try:
                from services.vyact_runtime import start_configured_runtime
                model_id = await asyncio.to_thread(
                    start_configured_runtime, vyact_config, config.get("debug_logging", False),
                )
                config["type"] = "vyact"
                config["model"] = model_id
                config["model_type"] = "chat"
                vyact_config["model"] = model_id
                common_settings = dict(config.get("runtime_settings", {}))
                config["runtime_settings"] = common_settings
                apply_runtime_settings({**common_settings, **_profile_runtime_settings(profile)})
                await warm_loaded_vyact_model(
                    model_id, await load_ui_language_async() or "", runtime,
                )
            except Exception as error:
                error_code = runtime_load_error_code(error)
                logger.warning("[vyact] model selection failed: %s", error)
                config.clear()
                config.update(previous_config)
                previous_vyact_config = config.get("vyact_config", {})
                if config.get("type") == "vyact" and previous_vyact_config.get("model_path"):
                    try:
                        restored_model_id = await asyncio.to_thread(
                            start_configured_runtime,
                            previous_vyact_config,
                            config.get("debug_logging", False),
                        )
                        await warm_loaded_vyact_model(
                            restored_model_id, await load_ui_language_async() or "",
                            previous_vyact_config.get("runtime", "gguf"),
                        )
                    except Exception as restore_error:
                        logger.warning("[vyact] previous model restore failed: %s", restore_error)
                message = error_code if error_code == "model_insufficient_memory" else f"Vyact 모델 로드 실패: {error}"
                yield sse(message, "error", 0)
                return
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
    # 더 이상 지원하지 않는 provider 값이 남아 있으면 선택 UI는
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
        # UI에는 런타임이 해석한 로컬 절대 경로가 아니라 모델 선택기에서 사용하는
        # 안정적인 식별자(mlx/<repository> 또는 GGUF model path)를 반환한다.
        "model": vyact_config.get("model_path"),
        "has_key": bool(vyact_config.get("model_path")),
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
        if not vyact_config.get("model_path"):
            raise HTTPException(400, "Vyact 모델이 없습니다. 먼저 모델을 다운로드하세요.")
        try:
            from services.vyact_runtime import start_configured_runtime

            model = await asyncio.to_thread(
                start_configured_runtime,
                vyact_config,
                config.get("debug_logging", False),
            )
        except (OSError, RuntimeError, ValueError) as error:
            logger.warning("[providers] Vyact provider activation failed: %s", error)
            raise HTTPException(503, "vyact_model_activation_failed") from error
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
    enabled = cfg.get("tool_logging", False)
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


@router.get("/settings/voice-auto-read")
async def get_voice_auto_read():
    cfg = await load_config_async()
    return {"enabled": cfg.get("voice_auto_read", False) is True}


class VoiceAutoReadSettings(BaseModel):
    enabled: bool = False


@router.post("/settings/voice-auto-read")
async def set_voice_auto_read(body: VoiceAutoReadSettings):
    es = get_es()
    try:
        await es.update(index=SETTINGS_INDEX, id="config",
                        doc={"value": {"voice_auto_read": body.enabled}},
                        upsert={"key": "config", "value": {"voice_auto_read": body.enabled}}, refresh=True)
    finally:
        await es.close()
    return {"enabled": body.enabled}
