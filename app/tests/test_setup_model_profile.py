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
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", start_runtime)

    await setup.select_provider(setup.ProviderSelectRequest(provider="vyact"))

    start_runtime.assert_called_once()
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
