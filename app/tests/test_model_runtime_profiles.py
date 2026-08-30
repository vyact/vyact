from unittest.mock import AsyncMock

import pytest
from elasticsearch import NotFoundError

from services import model_runtime_profiles
from services.model_runtime_profiles import (
    build_model_profile_id,
    delete_model_profile,
    normalize_model_profile,
    recommended_model_profile,
)


def test_profile_ids_are_stable_and_model_specific():
    assert build_model_profile_id("owner/model.gguf") == build_model_profile_id("owner/model.gguf")
    assert build_model_profile_id("owner/model.gguf") != build_model_profile_id("owner/other.gguf")


def test_recommended_profile_bounds_context_and_scales_output_limit():
    profile = recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 262144)

    assert profile["context_size"] == 131072
    assert profile["max_output_tokens"] == 4096
    assert profile["cache_quantization"] is True


def test_saved_profile_output_is_bounded_by_context():
    profile = normalize_model_profile({
        "model_path": "owner/small.gguf",
        "context_size": 4096,
        "max_output_tokens": 8192,
    })

    assert profile["context_size"] == 4096
    assert profile["max_output_tokens"] == 1024


def test_history_budget_is_stored_per_model_and_bounded_by_context():
    profile = normalize_model_profile({
        "model_path": "owner/small.gguf",
        "context_size": 4096,
        "history_token_budget": 12000,
    })

    assert profile["history_token_budget"] == 4096


def test_profile_rejects_mtp_with_kv_cache_quantization():
    with pytest.raises(ValueError, match="cannot be enabled together"):
        normalize_model_profile({
            "model_path": "owner/model.gguf",
            "context_size": 32768,
            "cache_quantization": True,
            "mtp_enabled": True,
        })


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
