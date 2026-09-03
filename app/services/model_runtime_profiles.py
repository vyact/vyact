"""Per-model local runtime profiles stored separately from global settings."""
import hashlib
from datetime import datetime, timezone

from elasticsearch import NotFoundError

from services.db import MODEL_RUNTIME_PROFILES_INDEX, get_es
from services.hardware_info import GPU_SPLIT_DECIMAL_PLACES, recommend_gpu_split_percentages, validate_gpu_split_percentages

DEFAULT_CONTEXT_SIZE = 32768
DEFAULT_MAX_OUTPUT_TOKENS = 2048
DEFAULT_HISTORY_TOKEN_BUDGET = 16384
MINIMUM_CONTEXT_RESERVE_TOKENS = 512
VALID_PERFORMANCE_MODES = {"auto", "memory", "performance"}
VALID_KV_CACHE_PRECISIONS = {"none", "q8", "q4"}
VALID_MTP_LOAD_FAILURE_CODES = {"load_failed", "out_of_memory"}
MAX_GPU_COUNT = 16
MAX_GPU_SPLIT_PERCENT = 100.0


def build_model_profile_id(model_path: str) -> str:
    return hashlib.sha256(model_path.encode("utf-8")).hexdigest()


def normalize_model_profile(profile: dict) -> dict:
    """Keep persisted generation settings inside the model's context window."""
    normalized = dict(profile)
    performance_mode = str(normalized.get("performance_mode") or "auto")
    if performance_mode not in VALID_PERFORMANCE_MODES:
        raise ValueError("Unsupported performance mode")
    kv_cache_precision = normalized.get("kv_cache_precision")
    if kv_cache_precision is None:
        kv_cache_precision = "q8" if bool(normalized.get("cache_quantization", True)) else "none"
    if kv_cache_precision not in VALID_KV_CACHE_PRECISIONS:
        raise ValueError("Unsupported KV cache precision")
    if normalized.get("runtime") == "mlx":
        # oMLX's paged/hot memory cache replaces the legacy mlx-lm KV
        # quantization setting. External VLM MTP remains cache-compatible.
        kv_cache_precision = "none"
    if normalized.get("runtime") != "mlx" and normalized.get("mtp_enabled") is True and kv_cache_precision != "none":
        raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
    normalized["performance_mode"] = performance_mode
    normalized["kv_cache_precision"] = kv_cache_precision
    normalized["cache_quantization"] = kv_cache_precision != "none"
    mtp_failure_code = normalized.get("mtp_failure_code")
    if mtp_failure_code not in VALID_MTP_LOAD_FAILURE_CODES:
        mtp_failure_code = None
    normalized["mtp_failure_code"] = mtp_failure_code
    normalized["mtp_failure_message"] = (
        str(normalized.get("mtp_failure_message") or "")[:500] if mtp_failure_code else None
    )
    normalized["mtp_failed_at"] = normalized.get("mtp_failed_at") if mtp_failure_code else None
    cpu_threads = normalized.get("cpu_threads")
    normalized["cpu_threads"] = None if cpu_threads in (None, "") else max(1, min(int(cpu_threads), 256))
    legacy_gpu_split = normalized.get("gpu_memory_allocations") or []
    gpu_split = normalized.get("gpu_split_percentages") or legacy_gpu_split
    if not isinstance(gpu_split, list):
        raise ValueError("GPU split percentages must be a list")
    if legacy_gpu_split and not normalized.get("gpu_split_percentages"):
        legacy_total = sum(max(0.0, float(value)) for value in legacy_gpu_split)
        gpu_split = [100.0 * max(0.0, float(value)) / legacy_total for value in legacy_gpu_split] if legacy_total else []
    normalized["gpu_split_percentages"] = [
        round(
            max(0.0, min(float(value), MAX_GPU_SPLIT_PERCENT)),
            GPU_SPLIT_DECIMAL_PLACES,
        )
        for value in gpu_split[:MAX_GPU_COUNT]
    ]
    normalized.pop("gpu_memory_allocations", None)
    normalized["gpu_manual_split_enabled"] = bool(normalized.get("gpu_manual_split_enabled", False))
    seed = normalized.get("seed")
    normalized["seed"] = None if seed in (None, "") else max(0, min(int(seed), 2147483647))
    safe_context = max(512, int(normalized.get("context_size") or DEFAULT_CONTEXT_SIZE))
    requested_output = max(1, int(normalized.get("max_output_tokens") or DEFAULT_MAX_OUTPUT_TOKENS))
    normalized["context_size"] = safe_context
    normalized["history_token_budget"] = max(
        0,
        min(int(normalized.get("history_token_budget", DEFAULT_HISTORY_TOKEN_BUDGET)), safe_context),
    )
    normalized["max_output_tokens"] = min(
        requested_output,
        max(1, safe_context // 4),
        max(1, safe_context - MINIMUM_CONTEXT_RESERVE_TOKENS),
    )
    return normalized


def normalize_gpu_split_for_hardware(profile: dict, hardware: dict) -> dict:
    """Migrate and align a profile's manual split with the currently visible GPUs."""
    normalized = dict(profile)
    gpu_split = normalized.get("gpu_split_percentages") or []
    legacy_gpu_split = normalized.get("gpu_memory_allocations") or []
    if not gpu_split and legacy_gpu_split:
        legacy_values = [max(0.0, float(value)) for value in legacy_gpu_split]
        legacy_total = sum(legacy_values)
        gpu_split = [100.0 * value / legacy_total for value in legacy_values] if legacy_total else []
    normalized.pop("gpu_memory_allocations", None)
    validated_split = validate_gpu_split_percentages(
        gpu_split, hardware,
    )
    normalized["gpu_manual_split_enabled"] = bool(normalized.get("gpu_manual_split_enabled", False))
    if validated_split:
        normalized["gpu_split_percentages"] = validated_split
        return normalized
    normalized["gpu_split_percentages"] = recommend_gpu_split_percentages(hardware)
    normalized["gpu_manual_split_enabled"] = False
    return normalized


def recommended_model_profile(model_path: str, runtime: str, repository: str | None, context_size: int) -> dict:
    safe_context = max(512, int(context_size or DEFAULT_CONTEXT_SIZE))
    if safe_context >= 65536:
        recommended_output = 4096
    elif safe_context <= 8192:
        recommended_output = 1024
    else:
        recommended_output = DEFAULT_MAX_OUTPUT_TOKENS
    recommended_history = min(safe_context // 2, 65536)
    return normalize_model_profile({
        "model_path": model_path,
        "runtime": runtime,
        "repository": repository,
        "context_size": safe_context,
        "max_output_tokens": min(
            recommended_output,
            max(1, safe_context // 4),
            max(1, safe_context - MINIMUM_CONTEXT_RESERVE_TOKENS),
        ),
        "history_token_budget": recommended_history,
        "temperature": 0.2,
        "top_k": None,
        "top_p": None,
        "cache_quantization": runtime != "mlx" and safe_context >= 32768,
        "kv_cache_precision": "q8" if runtime != "mlx" and safe_context >= 32768 else "none",
        "mtp_enabled": None,
        "performance_mode": "auto",
        "cpu_threads": None,
        "gpu_split_percentages": [],
        "gpu_manual_split_enabled": False,
        "seed": None,
    })


async def get_model_profile(model_path: str) -> dict | None:
    es = get_es()
    try:
        response = await es.get(index=MODEL_RUNTIME_PROFILES_INDEX, id=build_model_profile_id(model_path))
    except NotFoundError:
        return None
    return response.get("_source")


async def save_model_profile(profile: dict) -> dict:
    profile = normalize_model_profile(profile)
    es = get_es()
    now = datetime.now(timezone.utc).isoformat()
    existing = await get_model_profile(profile["model_path"])
    document = {**profile, "created_at": (existing or {}).get("created_at", now), "updated_at": now}
    await es.index(index=MODEL_RUNTIME_PROFILES_INDEX, id=build_model_profile_id(profile["model_path"]), document=document, refresh="wait_for")
    return document


async def delete_model_profile(model_path: str) -> None:
    es = get_es()
    try:
        await es.delete(
            index=MODEL_RUNTIME_PROFILES_INDEX,
            id=build_model_profile_id(model_path),
            refresh="wait_for",
        )
    except NotFoundError:
        pass
