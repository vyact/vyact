from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers import setup
from services import vyact_runtime


@pytest.mark.asyncio
async def test_model_profile_rejects_a_non_downloaded_gguf_as_not_found(monkeypatch):
    def reject_non_downloaded_model(_model_path: str):
        raise ValueError("not downloaded")

    monkeypatch.setattr(setup, "get_model_profile", AsyncMock(return_value=None))
    monkeypatch.setattr(setup, "get_downloaded_model_path", reject_non_downloaded_model)

    with pytest.raises(HTTPException) as error:
        await setup.read_vyact_model_profile(
            "gemini-3.1-flash-lite-preview",
            runtime="gguf",
            repository=None,
            recommended_context=32768,
        )

    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_new_model_profile_uses_hardware_recommendation(monkeypatch):
    save_profile = AsyncMock(side_effect=lambda profile: profile)
    monkeypatch.setattr(setup, "get_model_profile", AsyncMock(return_value=None))
    monkeypatch.setattr(setup, "_recommended_local_context", AsyncMock(return_value=65536))
    monkeypatch.setattr(setup, "save_model_profile", save_profile)

    profile = await setup._get_or_create_model_profile(
        "mlx/owner/model", "mlx", "owner/model", persist=True,
    )

    assert profile["context_size"] == 65536
    assert profile["history_token_budget"] == 32768
    assert profile["max_output_tokens"] == 4096
    save_profile.assert_awaited_once()


@pytest.mark.asyncio
async def test_existing_model_profile_is_not_recommended_again(monkeypatch):
    existing = {"model_path": "mlx/owner/model", "context_size": 32768}
    recommend_context = AsyncMock()
    monkeypatch.setattr(setup, "get_model_profile", AsyncMock(return_value=existing))
    monkeypatch.setattr(setup, "_recommended_local_context", recommend_context)

    profile = await setup._get_or_create_model_profile(
        "mlx/owner/model", "mlx", "owner/model", persist=True,
    )

    assert profile is existing
    recommend_context.assert_not_awaited()


@pytest.mark.asyncio
async def test_selecting_vyact_starts_model_before_persisting_provider(monkeypatch):
    config = {
        "type": "gemini",
        "model": "gemini-3.1-flash-lite-preview",
        "vyact_config": {"model_path": "mlx/owner/model", "runtime": "mlx"},
    }
    save_config = AsyncMock()
    start_runtime = Mock(return_value="owner/model")
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "save_config_async", save_config)
    profile = setup.recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 4096)
    profile.update({"top_k": 17, "seed": 42})
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=profile))
    apply_settings = Mock()
    monkeypatch.setattr(setup, "apply_runtime_settings", apply_settings)
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", start_runtime)

    await setup.select_provider(setup.ProviderSelectRequest(provider="vyact"))

    start_runtime.assert_called_once()
    assert start_runtime.call_args.args[0]["context_size"] == 4096
    assert apply_settings.call_args.args[0]["top_k"] == 17
    assert config["type"] == "vyact"
    assert config["model"] == "owner/model"
    save_config.assert_awaited_once_with(config)


@pytest.mark.asyncio
async def test_failed_vyact_activation_keeps_previous_provider(monkeypatch):
    config = {
        "type": "gemini",
        "model": "gemini-3.1-flash-lite-preview",
        "vyact_config": {"model_path": "mlx/owner/model", "runtime": "mlx"},
    }
    save_config = AsyncMock()
    start_runtime = Mock(side_effect=RuntimeError("failed to load"))
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "save_config_async", save_config)
    profile = setup.recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 4096)
    profile.update({"top_k": 17, "seed": 42})
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=profile))
    apply_settings = Mock()
    monkeypatch.setattr(setup, "apply_runtime_settings", apply_settings)
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", start_runtime)

    with pytest.raises(HTTPException) as error:
        await setup.select_provider(setup.ProviderSelectRequest(provider="vyact"))

    assert error.value.status_code == 503
    assert config["type"] == "gemini"
    assert config["model"] == "gemini-3.1-flash-lite-preview"
    save_config.assert_not_awaited()


@pytest.mark.asyncio
async def test_selecting_vyact_without_configured_model_keeps_previous_provider(monkeypatch):
    config = {
        "type": "gemini",
        "model": "gemini-3.1-flash-lite-preview",
        "vyact_config": {},
    }
    save_config = AsyncMock()
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "save_config_async", save_config)

    with pytest.raises(HTTPException) as error:
        await setup.select_provider(setup.ProviderSelectRequest(provider="vyact"))

    assert error.value.status_code == 400
    assert config["type"] == "gemini"
    assert config["model"] == "gemini-3.1-flash-lite-preview"
    save_config.assert_not_awaited()


@pytest.mark.asyncio
async def test_selecting_model_warms_it_before_reporting_done(monkeypatch):
    config = {"type": "vyact", "runtime_settings": {}, "vyact_config": {}}
    profile = {
        "repository": "owner/model", "context_size": 32768,
        "cache_quantization": True, "mtp_enabled": False,
        "kv_cache_precision": "none", "performance_mode": "auto",
        "cpu_threads": None, "seed": None, "max_output_tokens": 2048,
        "history_token_budget": 16384, "temperature": 0.2,
        "top_k": None, "top_p": None,
    }
    warm_model = AsyncMock(return_value=True)
    save_config = AsyncMock()
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=profile))
    monkeypatch.setattr(setup, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(setup, "warm_loaded_vyact_model", warm_model)
    monkeypatch.setattr(setup, "save_config_async", save_config)
    monkeypatch.setattr(setup, "apply_runtime_settings", Mock())
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", Mock(return_value="model"))

    response = await setup.select_model(setup.ModelSelectRequest(type="vyact", model="mlx/owner/model"))
    chunks = [chunk async for chunk in response.body_iterator]

    warm_model.assert_awaited_once_with("model", "ko", "mlx")
    save_config.assert_awaited_once_with(config)
    assert '"type": "done"' in "".join(chunks)


@pytest.mark.asyncio
async def test_failed_model_warmup_restores_previous_model_and_reports_memory_error(monkeypatch):
    config = {
        "type": "vyact", "model": "previous-model", "runtime_settings": {},
        "vyact_config": {
            "model": "previous-model", "model_path": "mlx/owner/previous-model", "runtime": "mlx",
        },
    }
    profile = {
        "repository": "owner/new-model", "context_size": 32768,
        "cache_quantization": True, "mtp_enabled": False,
        "kv_cache_precision": "none", "performance_mode": "auto",
        "cpu_threads": None, "seed": None, "max_output_tokens": 2048,
        "history_token_budget": 16384, "temperature": 0.2,
        "top_k": None, "top_p": None,
    }
    start_runtime = Mock(side_effect=["new-model", "previous-model"])
    warm_model = AsyncMock(side_effect=[
        RuntimeError("does not fit under the dynamic memory ceiling"), True,
    ])
    save_config = AsyncMock()
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=profile))
    monkeypatch.setattr(setup, "is_apple_silicon", lambda: True)
    monkeypatch.setattr(setup, "warm_loaded_vyact_model", warm_model)
    monkeypatch.setattr(setup, "save_config_async", save_config)
    monkeypatch.setattr(setup, "apply_runtime_settings", Mock())
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", start_runtime)

    response = await setup.select_model(setup.ModelSelectRequest(type="vyact", model="mlx/owner/new-model"))
    chunks = [chunk async for chunk in response.body_iterator]

    assert start_runtime.call_count == 2
    assert warm_model.await_args_list[1].args == ("previous-model", "ko", "mlx")
    assert config["model"] == "previous-model"
    assert config["vyact_config"]["model_path"] == "mlx/owner/previous-model"
    save_config.assert_not_awaited()
    assert "model_insufficient_memory" in "".join(chunks)


def test_model_profile_replaces_previous_gpu_split():
    profile = setup.recommended_model_profile("owner/model.gguf", "gguf", None, 4096)
    profile.update({"gpu_split_percentages": [70, 30], "gpu_manual_split_enabled": True})
    config = {"gpu_split_percentages": [50, 50], "gpu_manual_split_enabled": False}
    setup._apply_model_profile(config, profile)
    assert config["gpu_split_percentages"] == [70, 30]
    assert config["gpu_manual_split_enabled"] is True
