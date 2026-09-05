"""Hardware-aware initial profiles; memory figures are estimates, not load tests."""
import json
import math
import os
from pathlib import Path

from services.hardware_info import get_local_hardware_info
from services.installed_model_details import get_installed_model_details
from services.model_memory import estimate_downloaded_model_memory_bytes
from services.model_runtime_profiles import (
    DEFAULT_CONTEXT_SIZE, MINIMUM_CONTEXT_SIZE, MINIMUM_CONTEXT_RESERVE_TOKENS,
    MINIMUM_OUTPUT_TOKENS, normalize_model_profile, recommended_model_profile,
)
from services.mlx_runtime import get_downloaded_mlx_model_path, get_mlx_memory_companions
from services.vyact_runtime import (
    get_downloaded_model_path, get_cached_dflash2_model, get_cached_vision_projector,
)

GIB = 1024 ** 3
CONTEXT_STEP = 1024
MEMORY_HEADROOM_RATIO = 0.1
MINIMUM_MEMORY_HEADROOM = GIB


def _read_config(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, ValueError):
        return {}


def _positive_integer(value) -> int | None:
    if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 1:
        return int(value)
    return None


def downloaded_model_file_bytes(path: Path) -> int | None:
    try:
        if path.is_file():
            return path.stat().st_size
        weights = list(path.glob("*.safetensors")) or list(path.glob("*.bin"))
        return sum(file.stat().st_size for file in weights) if weights else None
    except OSError:
        return None


def profile_model_info(model_path: str, runtime: str) -> dict:
    path = get_downloaded_mlx_model_path(model_path) if runtime == "mlx" else get_downloaded_model_path(model_path)
    details = get_installed_model_details([model_path]).get(model_path, {}).get("metadata", {})
    context_max = _positive_integer(details.get("contextLength"))
    config = _read_config(path / "config.json") if runtime == "mlx" else {}
    text_config = config.get("text_config")
    if isinstance(text_config, dict):
        config = {**config, **text_config}
    # max_new_tokens in generation_config is a generation default, not a model capability limit.
    generation = _read_config(path / "generation_config.json") if runtime == "mlx" else {}
    explicit_output_max = _positive_integer(config.get("max_output_tokens"))
    context_min = min(MINIMUM_CONTEXT_SIZE, context_max or MINIMUM_CONTEXT_SIZE)
    if context_min < 512:
        raise ValueError("model_context_too_small")
    return {
        "path": path,
        "model_file_bytes": downloaded_model_file_bytes(path),
        "limits": {
            "context_min": context_min, "context_max": context_max,
            "output_min": min(MINIMUM_OUTPUT_TOKENS, explicit_output_max or MINIMUM_OUTPUT_TOKENS),
            "output_max": explicit_output_max,
            "context_reserve": MINIMUM_CONTEXT_RESERVE_TOKENS,
            "cpu_threads_max": os.cpu_count() or 1,
            "dflash_enabled": runtime == "gguf" and bool(get_cached_dflash2_model(path)),
        },
        "generation": generation,
    }


def model_memory_budget(hardware: dict) -> int | None:
    memory = hardware.get("system_memory", {})
    total = int(memory.get("total_bytes") or 0)
    available_value = memory.get("available_bytes")
    if total <= 0 or not isinstance(available_value, (int, float)) or available_value < 0:
        return None
    available = int(available_value)
    capacity = min(total, available)
    if hardware.get("platform") == "darwin":
        metal = int(hardware.get("metal_recommended_working_set_bytes") or 0)
        if metal > 0:
            capacity = min(capacity, metal)
    elif hardware.get("memory_mode") == "dedicated":
        gpus = [gpu for gpu in hardware.get("gpus", []) if not gpu.get("shared_memory")]
        if gpus:
            backend = gpus[0].get("backend")
            vram = sum(int(gpu.get("available_bytes") or 0) for gpu in gpus if gpu.get("backend") == backend)
            if vram <= 0:
                return None
            # Prefer GPU-resident defaults. Do not add RAM and VRAM as interchangeable capacity.
            capacity = min(capacity, vram)
    return max(0, capacity - max(MINIMUM_MEMORY_HEADROOM, int(capacity * MEMORY_HEADROOM_RATIO)))


def profile_memory_bytes(info: dict, runtime: str, context: int, precision: str) -> int:
    path = info["path"]
    estimate = estimate_downloaded_model_memory_bytes(path, runtime, context, precision)
    if estimate <= 0:
        return 0
    companions = get_mlx_memory_companions(path) if runtime == "mlx" else [
        get_cached_dflash2_model(path), get_cached_vision_projector(path),
    ]
    for companion in set(companion for companion in companions if companion):
        # Bundled MLX draft files are already included in the main model weight count.
        if path.is_dir() and path in companion.parents:
            continue
        try:
            if companion.is_dir():
                size = sum(file.stat().st_size for file in companion.rglob("*") if file.is_file())
            else:
                size = companion.stat().st_size
        except OSError:
            return 0
        estimate += size + max(512 * 1024 ** 2, int(size * .05))
    return estimate


def hardware_model_profile(model_path: str, runtime: str, repository: str | None, fallback: int) -> dict:
    info = profile_model_info(model_path, runtime)
    limits = info["limits"]
    hardware = get_local_hardware_info()
    budget = model_memory_budget(hardware)
    minimum = limits["context_min"]
    target = max(minimum, limits["context_max"] or fallback or DEFAULT_CONTEXT_SIZE)
    # MTP stays opt-in: available memory alone cannot prove a speed improvement.
    # DFlash2 is automatic and requires an unquantized cache.
    has_dflash = runtime == "gguf" and bool(get_cached_dflash2_model(info["path"]))
    precisions = ["none"] if runtime == "mlx" or has_dflash else ["none", "q8"]
    last_candidate = (target - minimum + CONTEXT_STEP - 1) // CONTEXT_STEP
    def candidate(index: int) -> int:
        return min(target, minimum + index * CONTEXT_STEP)
    selected_context, selected_precision = minimum, precisions[-1]
    known = False
    fits = False
    # Estimated memory is monotonic in context. Check the floor first, then use
    # binary search so a large model does not reread its metadata for every size.
    for precision in precisions:
        floor_memory = profile_memory_bytes(info, runtime, minimum, precision)
        known = known or floor_memory > 0
        if floor_memory <= 0 or budget is None or budget <= 0 or floor_memory > budget:
            continue
        lower, upper = 0, last_candidate
        while lower < upper:
            middle = (lower + upper + 1) // 2
            estimate = profile_memory_bytes(info, runtime, candidate(middle), precision)
            if 0 < estimate <= budget:
                lower = middle
            else:
                upper = middle - 1
        context = candidate(lower)
        if not fits or context > selected_context:
            selected_context, selected_precision = context, precision
        fits = True
        if context == target:
            break
    profile = recommended_model_profile(model_path, runtime, repository, selected_context, limits)
    profile.update(kv_cache_precision=selected_precision, cache_quantization=selected_precision != "none")
    generation = info["generation"]
    for key in ("temperature", "top_k", "top_p"):
        value = generation.get(key)
        if isinstance(value, (int, float)) and math.isfinite(value):
            profile[key] = value
    default_output = limits["output_max"] or _positive_integer(generation.get("max_new_tokens"))
    if default_output:
        profile["max_output_tokens"] = default_output
    profile["limits"] = limits
    profile = normalize_model_profile(profile, limits)
    reserve = min(MINIMUM_CONTEXT_RESERVE_TOKENS, profile["context_size"] // 2)
    profile["history_token_budget"] = max(0, profile["context_size"] - profile["max_output_tokens"] - reserve)
    profile["recommendation_status"] = "estimated" if fits else "insufficient" if known and budget is not None else "unavailable"
    return profile


def profile_memory_assessment(profile: dict, info: dict) -> dict:
    budget = model_memory_budget(get_local_hardware_info())
    estimate = profile_memory_bytes(info, profile["runtime"], profile["context_size"], profile["kv_cache_precision"])
    # Optional MTP has additional runtime-dependent allocations not measured here.
    if profile.get("mtp_enabled"):
        estimate = 0
    status = "unavailable" if budget is None or not estimate else "insufficient" if estimate > budget else "estimated"
    return {"estimated_memory_bytes": estimate, "recommendation_status": status}
