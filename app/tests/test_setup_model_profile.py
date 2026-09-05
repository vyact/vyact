from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import HTTPException

from routers import setup
from services import vyact_runtime, runtime_settings, runtime_startup
from services.llm.context_window import select_context_allocation


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
    monkeypatch.setattr(setup, "hardware_model_profile", Mock(return_value=setup.recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 65536)))
    monkeypatch.setattr(setup, "save_model_profile", save_profile)

    profile = await setup._get_or_create_model_profile(
        "mlx/owner/model", "mlx", "owner/model", persist=True,
    )

    assert profile["context_size"] == 65536
    assert profile["history_token_budget"] == 32256
    assert profile["max_output_tokens"] == 32256
    save_profile.assert_awaited_once()


@pytest.mark.asyncio
async def test_existing_model_profile_is_not_recommended_again(monkeypatch):
    existing = {"model_path": "mlx/owner/model", "context_size": 32768}
    recommend_context = Mock()
    monkeypatch.setattr(setup, "get_model_profile", AsyncMock(return_value=existing))
    monkeypatch.setattr(setup, "hardware_model_profile", recommend_context)

    profile = await setup._get_or_create_model_profile(
        "mlx/owner/model", "mlx", "owner/model", persist=True,
    )

    assert profile is existing
    recommend_context.assert_not_called()


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
    monkeypatch.setattr(runtime_startup, "save_model_profile", AsyncMock(side_effect=lambda value: value))
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
    monkeypatch.setattr(runtime_startup, "save_model_profile", AsyncMock(side_effect=lambda value: value))
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


@pytest.mark.asyncio
async def test_failed_model_switch_restores_sampling_and_logs_traceback(monkeypatch):

    monkeypatch.setattr(runtime_settings, "_settings", dict(runtime_settings.DEFAULT_RUNTIME_SETTINGS))
    previous = setup.recommended_model_profile("owner/old.gguf", "gguf", None, 4096)
    previous.update(temperature=0.2, top_k=10, seed=1)
    new = {**previous, "model_path": "owner/new.gguf", "temperature": 0.8, "top_k": 80, "seed": 99}
    config = {"type": "vyact", "model": "old", "vyact_config": previous.copy()}
    setup.apply_runtime_settings(setup._profile_runtime_settings(previous))
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=new))
    monkeypatch.setattr(setup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(setup, "warm_loaded_vyact_model", AsyncMock(side_effect=[RuntimeError("warmup failed"), True]))
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", Mock(side_effect=["new", "old"]))
    exception_log = Mock()
    monkeypatch.setattr(setup.logger, "exception", exception_log)
    response = await setup.select_model(setup.ModelSelectRequest(type="vyact", model="owner/new.gguf"))
    chunks = [chunk async for chunk in response.body_iterator]
    assert "error" in "".join(chunks)
    assert config["model"] == "old"
    settings = setup.get_runtime_settings()
    assert (settings["llm_temperature"], settings["top_k"], settings["seed"]) == (0.2, 10, 1)
    exception_log.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("entry", ["model", "provider"])
async def test_selection_persists_mtp_fallback(monkeypatch, entry):

    profile = setup.recommended_model_profile("owner/model.gguf", "gguf", None, 4096)
    profile.update(mtp_enabled=True, kv_cache_precision="none", cache_quantization=False)
    config = {"type": "vyact", "model": "old", "vyact_config": profile.copy()}
    def start(_config, _debug, status):
        status.update(mtp_fallback=True, mtp_failure_code="out_of_memory", mtp_failure_message="allocation failed")
        return "model"
    save_profile = AsyncMock(side_effect=lambda value: value)
    monkeypatch.setattr(runtime_startup, "save_model_profile", save_profile)
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=profile))
    monkeypatch.setattr(setup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(setup, "warm_loaded_vyact_model", AsyncMock())
    monkeypatch.setattr(setup, "save_config_async", AsyncMock())
    monkeypatch.setattr(setup, "apply_runtime_settings", Mock())
    monkeypatch.setattr(vyact_runtime, "start_configured_runtime", start)
    if entry == "model":
        response = await setup.select_model(setup.ModelSelectRequest(type="vyact", model=profile["model_path"]))
        chunks = [chunk async for chunk in response.body_iterator]
        assert '"type": "done"' in "".join(chunks)
    else:
        await setup.select_provider(setup.ProviderSelectRequest(provider="vyact"))
    saved = save_profile.await_args.args[0]
    assert saved["mtp_enabled"] is False
    assert saved["mtp_failure_code"] == "out_of_memory"
    assert saved["mtp_failed_at"]
    assert config["vyact_config"]["mtp_enabled"] is False


def test_small_context_matches_runtime_cache_and_allocation(monkeypatch):

    monkeypatch.setattr(runtime_settings, "_settings", dict(runtime_settings.DEFAULT_RUNTIME_SETTINGS))
    settings = runtime_settings.apply_runtime_settings({"llm_num_ctx": 4096})
    assert settings["llm_num_ctx"] == 4096
    context, _ = select_context_allocation([], 4096, 2.0, 512)
    assert context == 4096


@pytest.mark.asyncio
@pytest.mark.parametrize("restore_fails", [False, True])
async def test_settings_activation_reports_rollback_result(monkeypatch, restore_fails):
    monkeypatch.setattr(setup, "profile_model_info", Mock(return_value={"limits": {"context_min": 4096, "context_max": 32768}}))
    profile = setup.recommended_model_profile("owner/old.gguf", "gguf", None, 4096)
    profile.update(temperature=0.2, seed=1)
    config = {"type": "vyact", "model": "old", "vyact_config": profile.copy()}
    monkeypatch.setattr(runtime_settings, "_settings", dict(runtime_settings.DEFAULT_RUNTIME_SETTINGS))
    setup.apply_runtime_settings(setup._profile_runtime_settings(profile))
    monkeypatch.setattr(setup, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(setup, "save_config_async", AsyncMock())
    monkeypatch.setattr(setup, "save_model_profile", AsyncMock(side_effect=lambda value: value))
    monkeypatch.setattr(setup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(setup, "warm_loaded_vyact_model", AsyncMock(side_effect=[RuntimeError("warmup failed"), True]))
    monkeypatch.setattr(vyact_runtime, "get_downloaded_model_path", Mock(return_value="new.gguf"))
    monkeypatch.setattr(vyact_runtime, "start_single_model", Mock(return_value="new"))
    monkeypatch.setattr(vyact_runtime, "get_loaded_context_size", Mock(return_value=4096))
    restore = Mock(side_effect=RuntimeError("restore failed")) if restore_fails else Mock(return_value="old")
    monkeypatch.setattr(setup, "start_configured_runtime", restore)
    response = await setup.activate_vyact_model(setup.VyactModelActivateRequest(
        model_path="owner/new.gguf", context_size=4096, temperature=0.8, seed=99,
    ))
    chunks = [chunk async for chunk in response.body_iterator]
    assert f'"recovery": "{"failed" if restore_fails else "restored"}"' in "".join(chunks)
    restore.assert_called_once()
    settings = setup.get_runtime_settings()
    assert (settings["llm_temperature"], settings["seed"]) == (0.2, 1)


@pytest.mark.asyncio
async def test_profile_save_applies_model_and_hardware_bounds(monkeypatch):
    limits = {"context_min": 4096, "context_max": 131072, "output_max": 65536}
    monkeypatch.setattr(setup, "profile_model_info", Mock(return_value={"limits": limits}))
    monkeypatch.setattr(setup, "get_local_hardware_info", Mock(return_value={"gpus": []}))
    save = AsyncMock(side_effect=lambda profile: profile)
    monkeypatch.setattr(setup, "save_model_profile", save)
    result = await setup.write_vyact_model_profile(setup.VyactModelProfileRequest(
        model_path="owner/model.gguf", context_size=512, max_output_tokens=1, history_token_budget=999999,
    ))
    assert (result["context_size"], result["max_output_tokens"], result["history_token_budget"]) == (4096, 256, 2816)
    result = await setup.write_vyact_model_profile(setup.VyactModelProfileRequest(
        model_path="owner/model.gguf", context_size=131072, max_output_tokens=65536,
    ))
    assert result["max_output_tokens"] == 65536
    assert save.await_count == 2


@pytest.mark.asyncio
async def test_read_marks_adjusted_saved_settings_for_application(monkeypatch):
    saved = setup.recommended_model_profile("owner/model.gguf", "gguf", None, 32768)
    saved.update(context_size=512, max_output_tokens=1, history_token_budget=0)
    monkeypatch.setattr(setup, "_get_or_create_model_profile", AsyncMock(return_value=saved))
    monkeypatch.setattr(setup, "profile_model_info", Mock(return_value={"limits": {"context_min": 4096, "context_max": 32768}}))
    monkeypatch.setattr(setup, "get_downloaded_model_path", Mock(return_value="model.gguf"))
    monkeypatch.setattr(setup, "get_local_hardware_info", Mock(return_value={"gpus": []}))
    monkeypatch.setattr(setup, "get_gguf_reasoning_capabilities", Mock(return_value={}))
    monkeypatch.setattr(setup, "get_model_modalities", Mock(return_value=[]))
    monkeypatch.setattr(setup, "profile_memory_assessment", Mock(return_value={}))
    result = await setup.read_vyact_model_profile("owner/model.gguf", "gguf", None, 32768)
    assert result["context_size"] == 4096
    assert result["max_output_tokens"] == 256
    assert result["requires_apply"] is True
    assert saved["context_size"] == 512  # A GET must not overwrite the saved profile.


@pytest.mark.parametrize("request_type", [setup.VyactModelProfileRequest, setup.VyactModelActivateRequest])
def test_model_sampling_defaults_are_accepted_by_save_and_activate(request_type):
    request = request_type(model_path="owner/model.gguf", temperature=1.5, top_k=200)
    assert request.temperature == 1.5
    assert request.top_k == 200
