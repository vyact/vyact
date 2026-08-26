"""Per-model local runtime profiles stored separately from global settings."""
import hashlib
from datetime import datetime, timezone

from elasticsearch import NotFoundError

from services.db import MODEL_RUNTIME_PROFILES_INDEX, get_es

DEFAULT_CONTEXT_SIZE = 32768
DEFAULT_MAX_OUTPUT_TOKENS = 2048
DEFAULT_HISTORY_TOKEN_BUDGET = 16384
MINIMUM_CONTEXT_RESERVE_TOKENS = 512
VALID_PERFORMANCE_MODES = {"auto", "memory", "performance"}
VALID_KV_CACHE_PRECISIONS = {"none", "q8", "q4"}


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
    if normalized.get("mtp_enabled") is True and kv_cache_precision != "none":
        raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
    normalized["performance_mode"] = performance_mode
    normalized["kv_cache_precision"] = kv_cache_precision
    normalized["cache_quantization"] = kv_cache_precision != "none"
    cpu_threads = normalized.get("cpu_threads")
    normalized["cpu_threads"] = None if cpu_threads in (None, "") else max(1, min(int(cpu_threads), 256))
    seed = normalized.get("seed")
    normalized["seed"] = None if seed in (None, "") else max(0, min(int(seed), 2147483647))
    safe_context = max(512, min(int(normalized.get("context_size") or DEFAULT_CONTEXT_SIZE), 131072))
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


def recommended_model_profile(model_path: str, runtime: str, repository: str | None, context_size: int) -> dict:
    safe_context = max(512, min(int(context_size or DEFAULT_CONTEXT_SIZE), 131072))
    return normalize_model_profile({
        "model_path": model_path,
        "runtime": runtime,
        "repository": repository,
        "context_size": safe_context,
        "max_output_tokens": min(
            DEFAULT_MAX_OUTPUT_TOKENS,
            max(1, safe_context // 4),
            max(1, safe_context - MINIMUM_CONTEXT_RESERVE_TOKENS),
        ),
        "history_token_budget": min(DEFAULT_HISTORY_TOKEN_BUDGET, safe_context),
        "temperature": 0.2,
        "top_k": None,
        "top_p": None,
        "cache_quantization": safe_context >= 32768,
        "kv_cache_precision": "q8" if safe_context >= 32768 else "none",
        "mtp_enabled": None,
        "performance_mode": "auto",
        "cpu_threads": None,
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
