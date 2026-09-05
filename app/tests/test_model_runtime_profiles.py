from unittest.mock import AsyncMock

import pytest
from elasticsearch import NotFoundError

from services import model_runtime_profiles
from services.model_runtime_profiles import (
    build_model_profile_id,
    delete_model_profile,
    normalize_gpu_split_for_hardware,
    normalize_model_profile,
    recommended_model_profile,
)


def test_profile_ids_are_stable_and_model_specific():
    assert build_model_profile_id("owner/model.gguf") == build_model_profile_id("owner/model.gguf")
    assert build_model_profile_id("owner/model.gguf") != build_model_profile_id("owner/other.gguf")


def test_recommended_profile_preserves_model_context_and_scales_output_limit():
    profile = recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 262144)

    assert profile["context_size"] == 262144
    assert profile["max_output_tokens"] == 130560
    assert profile["cache_quantization"] is False
    assert profile["kv_cache_precision"] == "none"


def test_saved_profile_output_is_bounded_by_context():
    profile = normalize_model_profile({
        "model_path": "owner/small.gguf",
        "context_size": 4096,
        "max_output_tokens": 8192,
    })

    assert profile["context_size"] == 4096
    assert profile["max_output_tokens"] == 3072


def test_history_budget_is_stored_per_model_and_bounded_by_context():
    profile = normalize_model_profile({
        "model_path": "owner/small.gguf",
        "context_size": 4096,
        "history_token_budget": 12000,
    })

    assert profile["history_token_budget"] == 1024


def test_gpu_split_percentages_are_normalized_and_bounded():
    profile = normalize_model_profile({
        "model_path": "owner/model.gguf",
        "gpu_split_percentages": [-1, 12.5, 5000],
    })

    assert profile["gpu_split_percentages"] == [0.0, 12.5, 100.0]


def test_legacy_gpu_allocations_migrate_to_split_values():
    profile = normalize_model_profile({
        "model_path": "owner/model.gguf",
        "gpu_memory_allocations": [8, 4],
    })

    assert profile["gpu_split_percentages"] == pytest.approx([66.67, 33.33], abs=0.01)
    assert "gpu_memory_allocations" not in profile


def test_manual_gpu_split_is_disabled_by_default():
    profile = normalize_model_profile({"model_path": "owner/model.gguf"})

    assert profile["gpu_manual_split_enabled"] is False


def test_gpu_split_is_recommended_again_when_visible_gpu_count_changes():
    hardware = {"gpus": [
        {"backend": "CUDA", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
        {"backend": "CUDA", "total_bytes": 12 * 1024 ** 3, "shared_memory": False},
    ]}
    profile = normalize_gpu_split_for_hardware({
        "model_path": "owner/model.gguf",
        "gpu_split_percentages": [50, 30, 20],
        "gpu_manual_split_enabled": True,
    }, hardware)

    assert profile["gpu_split_percentages"] == [66.67, 33.33]
    assert profile["gpu_manual_split_enabled"] is False


def test_legacy_gpu_split_stays_enabled_after_safe_hardware_migration():
    hardware = {"gpus": [
        {"backend": "CUDA", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
        {"backend": "CUDA", "total_bytes": 12 * 1024 ** 3, "shared_memory": False},
    ]}
    profile = normalize_gpu_split_for_hardware({
        "model_path": "owner/model.gguf",
        "gpu_memory_allocations": [8, 4],
        "gpu_manual_split_enabled": True,
    }, hardware)

    assert profile["gpu_split_percentages"] == [66.67, 33.33]
    assert profile["gpu_manual_split_enabled"] is True


def test_profile_rejects_mtp_with_kv_cache_quantization():
    with pytest.raises(ValueError, match="cannot be enabled together"):
        normalize_model_profile({
            "model_path": "owner/model.gguf",
            "context_size": 32768,
            "cache_quantization": True,
            "mtp_enabled": True,
        })


def test_mtp_load_failure_is_normalized_and_cleared_without_failure_code():
    failed = normalize_model_profile({
        "model_path": "owner/model.gguf",
        "mtp_enabled": False,
        "mtp_failure_code": "load_failed",
        "mtp_failure_message": "draft failed",
        "mtp_failed_at": "2026-09-02T00:00:00+00:00",
    })
    assert failed["mtp_failure_code"] == "load_failed"
    assert failed["mtp_failure_message"] == "draft failed"

    cleared = normalize_model_profile({**failed, "mtp_failure_code": None})
    assert cleared["mtp_failure_message"] is None
    assert cleared["mtp_failed_at"] is None


@pytest.mark.asyncio
async def test_delete_profile_removes_matching_document(monkeypatch):
    es = AsyncMock()
    monkeypatch.setattr(model_runtime_profiles, "get_es", lambda: es)

    await delete_model_profile("mlx/owner/model")

    es.delete.assert_awaited_once_with(
        index=model_runtime_profiles.MODEL_RUNTIME_PROFILES_INDEX,
        id=build_model_profile_id("mlx/owner/model"),
        refresh="wait_for",
    )


@pytest.mark.asyncio
async def test_delete_profile_ignores_missing_documents(monkeypatch):
    es = AsyncMock()
    es.delete.side_effect = NotFoundError(message="not found", meta=None, body=None)
    monkeypatch.setattr(model_runtime_profiles, "get_es", lambda: es)

    await delete_model_profile("mlx/owner/missing")


def test_model_specific_bounds_override_global_defaults():
    limits = {"context_min": 4096, "context_max": 65536, "output_max": 512}
    profile = normalize_model_profile({"context_size": 999999, "max_output_tokens": 8192, "history_token_budget": 999999}, limits)
    assert profile["context_size"] == 65536
    assert profile["max_output_tokens"] == 512
    assert profile["history_token_budget"] == 64000
    small = normalize_model_profile({"context_size": 1, "max_output_tokens": 1}, limits)
    assert small["context_size"] == 4096
    assert small["max_output_tokens"] == 256


def test_small_model_output_limit_takes_precedence_over_output_floor():
    profile = normalize_model_profile({"context_size": 4096, "max_output_tokens": 1}, {"output_max": 64})
    assert profile["max_output_tokens"] == 64


def test_zero_sampling_history_seed_and_automatic_threads_are_preserved():
    profile = normalize_model_profile({"history_token_budget": 0, "temperature": 0, "top_k": 0, "top_p": 0, "seed": 0, "cpu_threads": None})
    assert all(profile[key] == 0 for key in ("history_token_budget", "temperature", "top_k", "top_p", "seed"))
    assert profile["cpu_threads"] is None


def test_cpu_threads_are_bounded_by_detected_cpu(monkeypatch):
    monkeypatch.setattr(model_runtime_profiles.os, "cpu_count", lambda: 8)
    assert normalize_model_profile({"cpu_threads": 200})["cpu_threads"] == 8


@pytest.mark.parametrize("field", ["temperature", "top_k", "top_p", "seed"])
def test_nonfinite_sampling_values_are_rejected(field):
    with pytest.raises(ValueError):
        normalize_model_profile({field: float("nan")})


def test_dflash_constraints_disable_incompatible_cache_and_mtp():
    result = normalize_model_profile({"runtime": "gguf", "mtp_enabled": True, "kv_cache_precision": "q8"}, {"dflash_enabled": True})
    assert result["kv_cache_precision"] == "none"
    assert result["cache_quantization"] is False
    assert result["mtp_enabled"] is False


def test_sampling_metadata_is_not_cut_to_arbitrary_one_or_100():
    result = normalize_model_profile({"temperature": 1.5, "top_k": 200})
    assert result["temperature"] == 1.5
    assert result["top_k"] == 200
