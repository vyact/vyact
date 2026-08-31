import json
import struct

from services.model_memory import MINIMUM_RUNTIME_BUFFER_BYTES, estimate_downloaded_model_memory_bytes


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def _gguf_metadata_value(key: str, value) -> bytes:
    if isinstance(value, str):
        return _gguf_string(key) + struct.pack("<I", 8) + _gguf_string(value)
    return _gguf_string(key) + struct.pack("<II", 4, value)


def test_downloaded_mlx_memory_uses_local_metadata_and_context(tmp_path):
    config = {
        "num_hidden_layers": 2,
        "num_attention_heads": 4,
        "num_key_value_heads": 2,
        "hidden_size": 16,
        "max_position_embeddings": 8192,
    }
    (tmp_path / "config.json").write_text(json.dumps(config), encoding="utf-8")
    (tmp_path / "model.safetensors").write_bytes(b"x" * 1000)

    estimated = estimate_downloaded_model_memory_bytes(tmp_path, "mlx", 4096, "none")

    downloaded_size = (tmp_path / "config.json").stat().st_size + 1000
    expected_kv_cache = 4096 * 2 * 2 * 4 * 2 * 2
    assert estimated == downloaded_size + expected_kv_cache + MINIMUM_RUNTIME_BUFFER_BYTES


def test_downloaded_model_memory_returns_zero_for_invalid_gguf(tmp_path):
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"not-gguf")

    assert estimate_downloaded_model_memory_bytes(model_path, "gguf", 32768, "q8") == 0


def test_downloaded_gguf_memory_uses_header_metadata_and_context(tmp_path):
    values = {
        "general.architecture": "test",
        "test.block_count": 2,
        "test.attention.head_count": 4,
        "test.attention.head_count_kv": 2,
        "test.embedding_length": 16,
        "test.context_length": 8192,
    }
    metadata = b"".join(_gguf_metadata_value(key, value) for key, value in values.items())
    model_path = tmp_path / "model.gguf"
    model_path.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, len(values)) + metadata)

    estimated = estimate_downloaded_model_memory_bytes(model_path, "gguf", 4096, "none")

    expected_kv_cache = 4096 * 2 * 2 * (4 + 4) * 2
    assert estimated == model_path.stat().st_size + expected_kv_cache + MINIMUM_RUNTIME_BUFFER_BYTES
