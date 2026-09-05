"""Memory estimates derived from downloaded local-model metadata."""
import json
import math
from pathlib import Path

from services.huggingface_models import calculate_mlx_metadata_from_config
from services.reasoning_capabilities import read_gguf_metadata

MINIMUM_RUNTIME_BUFFER_BYTES = 512 * 1024 ** 2
KV_BYTES_PER_VALUE = {"none": 2.0, "q8": 1.0625, "q4": 0.5625}


def _downloaded_size(model_path: Path) -> int:
    if model_path.is_file():
        return model_path.stat().st_size
    return sum(path.stat().st_size for path in model_path.rglob("*") if path.is_file())


def _estimate_gguf_memory_bytes(
    model_path: Path, context_size: int, kv_cache_precision: str,
) -> int:
    architecture = str(read_gguf_metadata(model_path, {"general.architecture"}).get("general.architecture") or "")
    if not architecture:
        return 0
    prefix = f"{architecture}."
    metadata = read_gguf_metadata(model_path, {
        f"{prefix}block_count",
        f"{prefix}attention.head_count",
        f"{prefix}attention.head_count_kv",
        f"{prefix}embedding_length",
        f"{prefix}attention.key_length",
        f"{prefix}attention.value_length",
        f"{prefix}full_attention_interval",
        f"{prefix}context_length",
    })
    number = lambda key: float(metadata.get(f"{prefix}{key}") or 0)
    block_count = number("block_count")
    head_count = number("attention.head_count")
    kv_head_count = number("attention.head_count_kv") or head_count
    embedding_length = number("embedding_length")
    key_length = number("attention.key_length") or (embedding_length / head_count if head_count else 0)
    value_length = number("attention.value_length") or key_length
    if not block_count or not kv_head_count or not key_length or not value_length:
        return 0
    full_attention_interval = max(1, int(number("full_attention_interval") or 1))
    attention_layer_count = math.ceil(block_count / full_attention_interval)
    model_context = int(number("context_length"))
    effective_context = min(context_size, model_context or context_size)
    kv_cache_bytes = (
        effective_context * attention_layer_count * kv_head_count * (key_length + value_length)
        * KV_BYTES_PER_VALUE.get(kv_cache_precision, KV_BYTES_PER_VALUE["none"])
    )
    file_size = model_path.stat().st_size
    runtime_buffer_bytes = max(MINIMUM_RUNTIME_BUFFER_BYTES, math.ceil(file_size * .05))
    return math.ceil(file_size + kv_cache_bytes + runtime_buffer_bytes)


def estimate_downloaded_model_memory_bytes(
    model_path: Path, runtime: str, context_size: int, kv_cache_precision: str,
) -> int:
    """Estimate weight, KV-cache, and runtime-buffer memory from local files."""
    try:
        if runtime == "mlx":
            config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
            metadata = calculate_mlx_metadata_from_config(
                config, _downloaded_size(model_path), context_size, kv_cache_precision,
            )
            if not metadata.get("block_count") or not metadata.get("kv_cache_bytes"):
                return 0
            return math.ceil(float(metadata["estimated_memory_bytes"]))
        return _estimate_gguf_memory_bytes(model_path, context_size, kv_cache_precision)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return 0
