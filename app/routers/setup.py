"""
routers/setup.py – 설치 / 모델 / Provider / 상태
"""
import asyncio
import math
import os
import platform
import re

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent import get_index_stats
from config import (
    DEFAULT_MODEL, INSTALL_DIR, LOGS_DIR, RECOMMENDED_MODELS,
    IMAGE_MODEL_IDS, SETUP_DONE, VENV_DIR, get_log_file,
)
from config.models import LLM_INITIAL_NUM_CTX, LLM_MAX_NUM_CTX
from routers.deps import APP_DIR, load_config_async, save_config_async, sse, write_log
from logger import get_logger
from services.installer import is_docker_available, Installer
from services.es_native import is_native_supported
from services.mcp_config import ensure_mcp_config
from services.runtime_settings import DEFAULT_RUNTIME_SETTINGS, apply_runtime_settings, get_runtime_settings

logger = get_logger(__name__)

ANSI_ESCAPE_PATTERN = re.compile(r"\x1B\[[0-?]*[ -/]*[@-~]")
OLLAMA_PROGRESS_PATTERN = re.compile(r"\b(\d{1,3})%")


def start_background_services_after_setup() -> None:
    """Start services skipped during the first-run installation lifespan."""
    from services.notification_polling import start_notification_polling
    start_notification_polling()


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

    async def stream():
        cfg = {"type": req.type, "model": req.model, "api_key": req.api_key, "config": req.config or {}}

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
            ok, msg = await installer.install_ollama()
            if not ok: yield sse(msg, "error", 0); return
            yield sse(msg, "ok", 25)

            yield sse("Checking Ollama server...", "info", 27)
            ok, msg = await installer.start_ollama_server()
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

            yield sse("Downloading embedding model (bge-m3)...", "info", 67)
            try:
                from services.ollama_manager import ensure_embed_model
                ok = await ensure_embed_model("bge-m3")
                if ok:
                    yield sse("bge-m3 ready", "ok", 72)
                else:
                    yield sse("bge-m3 download failed (will retry later)", "log", 72)
            except Exception as e:
                yield sse(f"bge-m3 error: {e}", "log", 72)

            yield sse("Creating Python virtual environment...", "info", 74)
            ok, msg = await installer.setup_venv()
            if not ok: yield sse(msg, "error", 0); return
            yield sse(msg, "ok", 76)

            yield sse("Using installed app files", "ok", 78)

            # Electron이 서버를 시작하기 전에 requirements.txt를 가상환경에 설치한다.
            # 여기서 다시 pip을 실행하면 macOS와 Windows 모두 동일한 패키지를 두 번
            # 확인·설치하게 되므로, 준비 완료 상태만 사용자에게 알린다.
            yield sse("Python packages ready", "ok", 88)

            if is_japanese_system_language():
                yield sse("Installing UniDic dictionary for Japanese TTS...", "info", 88)
                ok, msg = await installer.install_unidic_dictionary()
                # 일본어 TTS만 제한되므로 전체 설치는 계속 진행한다.
                yield sse(msg, "ok" if ok else "log", 89)
            else:
                yield sse("Japanese TTS dictionary will download when first needed", "ok", 89)

            yield sse("Installing Playwright browser...", "info", 88)
            ok, msg = await installer.install_playwright()
            yield sse(msg, "ok", 91)

            yield sse("Installing espeak-ng (Kokoro TTS)...", "info", 92)
            ok, msg = await installer.install_espeak()
            yield sse(msg, "ok" if ok else "log", 93)

            yield sse("Downloading Kokoro TTS model...", "info", 93)
            ok, msg = await installer.download_kokoro_model()
            yield sse(msg, "ok" if ok else "log", 94)

            yield sse("Warming up Kokoro TTS...", "info", 94)
            from main import warmup_kokoro_tts
            tts_ready = await warmup_kokoro_tts()
            yield sse(
                "Kokoro TTS ready" if tts_ready else "Kokoro TTS warm-up skipped",
                "ok" if tts_ready else "log",
                95,
            )

            # ES가 이미 떠 있으면 컨테이너 기동을 건너뛴다(위에서 감지)
            if es_running:
                yield sse("Using existing Elasticsearch — skipping start", "ok", 99)
            else:
                yield sse("Starting Elasticsearch...", "info", 95)
                ok, msg = await installer.start_elasticsearch()
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
                logger.warning("[setup] 초기화 실패: %s", e)

            # 첫 대화 지연을 막기 위해 다운로드한 모델을 설치 완료 전에 실제 메모리에 올린다.
            yield sse(f"Loading {model} into memory...", "info", 96)
            try:
                from services.ollama_manager import get_loaded_model_names, load_embed_model, load_model

                chat_ready = await load_model(model)
                embed_ready = await load_embed_model("bge-m3")
                loaded_models = await get_loaded_model_names()
                model_loaded = any(name.split(":", 1)[0] == model.split(":", 1)[0] for name in loaded_models)
                embed_loaded = any(name.split(":", 1)[0] == "bge-m3" for name in loaded_models)

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
                if not (embed_ready and embed_loaded):
                    yield sse("bge-m3 could not stay loaded (memory may be insufficient)", "log", 98)
            except Exception as e:
                logger.warning("[setup] Ollama model warm-up failed: %s", e)
                yield sse(f"Model warm-up failed: {e}", "log", 98)

            await installer.finalize_setup(SETUP_DONE)
            start_background_services_after_setup()
            yield sse("Installation complete!", "done", 100)
        else:
            installer = Installer(INSTALL_DIR, APP_DIR, VENV_DIR, get_log_file("event"))

            yield sse("Validating API Key...", "info", 10)
            await save_config_async(cfg)

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
                yield sse(msg, "ok", 70)

            # ES 인덱스 초기화
            try:
                from agent import ensure_index, load_prompts_cache
                from routers.skills import ensure_skills_index
                await ensure_index()
                await ensure_skills_index()
                await ensure_mcp_config()
                await load_prompts_cache()
                logger.info("[setup] Cloud setup ES init complete")
            except Exception as e:
                logger.warning("[setup] Cloud setup init failed: %s", e)

            SETUP_DONE.touch()
            start_background_services_after_setup()
            yield sse("Setup complete!", "done", 100)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── Models ────────────────────────────────────
@router.get("/models")
async def get_models():
    EMBED_MODELS = {"bge-m3", "nomic-embed-text", "mxbai-embed-large"}
    recommended_ids = [m["id"] for m in RECOMMENDED_MODELS]
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
    cfg = await load_config_async()
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
            config["type"] = req.type
            config["model"] = req.model
            if req.api_key:
                config["api_key"] = req.api_key
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
            if not req.api_key:
                yield sse(f"{req.type.upper()} API KEY 필요", "error", 0);
                return
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
    return {
        "current_type": config.get("type", "ollama"),
        "current_model": config.get("model"),
        "providers": providers,
    }


@router.post("/providers/{provider}")
async def save_provider(provider: str, req: ProviderConfigRequest):
    if provider not in ["openai", "gemini", "claude"]:
        raise HTTPException(400, "지원하지 않는 provider")
    try:
        config = await load_config_async()
        config[f"{provider}_config"] = {"api_key": req.api_key, "model": req.model}
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
    else:
        key = f"{req.provider}_config"
        if key not in config:
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
    return {"tool_logging": cfg.get("tool_logging", False)}


@router.post("/settings/tool-logging")
async def set_tool_logging(body: dict):
    cfg = await load_config_async()
    cfg["tool_logging"] = bool(body.get("enabled", False))
    await save_config_async(cfg)
    return {"tool_logging": cfg["tool_logging"]}


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
