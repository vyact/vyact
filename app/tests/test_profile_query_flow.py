"""Exercise persisted profile -> runtime settings -> production HTTP request body."""
import json
from unittest.mock import AsyncMock

import httpx
import pytest

from routers import deps, setup
from services import runtime_settings, runtime_startup
from services.llm import providers, token_counter
from services.mcp_client import mcp_manager
from services.model_runtime_profiles import recommended_model_profile


@pytest.mark.asyncio
@pytest.mark.parametrize("runtime", ["gguf", "mlx"])
@pytest.mark.parametrize("use_tools", [False, True])
async def test_saved_settings_reach_answer_and_tool_rounds(monkeypatch, runtime, use_tools):
    profile = recommended_model_profile("owner/model.gguf", runtime, None, 32768)
    profile.update(temperature=0, top_k=0, top_p=0, seed=0, max_output_tokens=16000)
    config = {"type": "vyact", "model": "test-model", "vyact_config": profile}
    monkeypatch.setattr(deps, "load_config_async", AsyncMock(return_value=config))
    monkeypatch.setattr(runtime_settings, "_settings", dict(runtime_settings.DEFAULT_RUNTIME_SETTINGS))
    runtime_settings.apply_runtime_settings(setup._profile_runtime_settings(profile))
    # Keep real profile/config/body construction, mock only tokenization and I/O.
    monkeypatch.setattr(token_counter, "count_local_message_tokens", AsyncMock(side_effect=[1000, 20000] if use_tools else [1000]))
    tool = {"type": "function", "function": {"name": "test_echo", "description": "test", "parameters": {"type": "object", "properties": {}}}}
    monkeypatch.setattr(providers, "_get_unified_tools", AsyncMock(return_value=([tool], ["test_echo"]) if use_tools else ([], [])))
    monkeypatch.setattr(providers, "build_tool_directive", AsyncMock(return_value=""))
    monkeypatch.setattr(providers, "await_tool_approval", AsyncMock(return_value=True))
    monkeypatch.setattr(mcp_manager, "call_tool", AsyncMock(return_value="test result"))
    monkeypatch.setattr(mcp_manager, "drain_tool_sources", lambda: [])
    bodies = []

    def respond(request):
        body = json.loads(request.content)
        bodies.append(body)
        delta = {"content": "ok"}
        if use_tools and len(bodies) == 1:
            delta = {"tool_calls": [{"index": 0, "id": "test-call", "type": "function", "function": {"name": "test_echo", "arguments": "{}"}}]}
        content = 'data: ' + json.dumps({"choices": [{"delta": delta}]}) + '\n\ndata: [DONE]\n\n'
        return httpx.Response(200, text=content, headers={"content-type": "text/event-stream"})

    async with httpx.AsyncClient(transport=httpx.MockTransport(respond)) as client:
        result = [part async for part in providers.openai_stream(
            client, "test-model", None, "system", "test question", [], [], [], 30,
            use_tools=use_tools, reasoning=False,
        )]
    assert result == ["ok"]
    assert len(bodies) == (2 if use_tools else 1)
    for body in bodies:
        assert (body["temperature"], body["top_k"], body["top_p"], body["seed"]) == (0, 0, 0, 0)
        assert body["model"] == "test-model"
    assert bodies[0]["max_tokens"] == 16000  # Not silently capped to 8192.
    if use_tools:
        assert bodies[1]["max_tokens"] == 12256  # Real input growth leaves less output space.
        assert bodies[1]["messages"][-1]["role"] == "tool"


@pytest.mark.asyncio
async def test_effective_context_updates_profile_config_and_query_budgets(monkeypatch):
    profile = recommended_model_profile("owner/model.gguf", "gguf", None, 32768)
    profile.update(max_output_tokens=16000, history_token_budget=15000)
    profile["limits"] = {"context_min": 4096, "context_max": 32768}
    config = {**profile, "context_size": 8192}
    saved = AsyncMock(side_effect=lambda value: value)
    monkeypatch.setattr(runtime_startup, "save_model_profile", saved)
    effective = await runtime_startup.persist_loaded_model_profile(profile, config, {})
    assert effective["context_size"] == config["context_size"] == 8192
    assert effective["max_output_tokens"] == config["max_output_tokens"] == 7168
    assert effective["history_token_budget"] == config["history_token_budget"] == 0
    saved.assert_awaited_once()


@pytest.mark.asyncio
async def test_actual_context_below_practical_floor_is_not_saved(monkeypatch):
    profile = recommended_model_profile("owner/model.gguf", "gguf", None, 32768)
    profile["limits"] = {"context_min": 4096}
    saved = AsyncMock()
    monkeypatch.setattr(runtime_startup, "save_model_profile", saved)
    with pytest.raises(RuntimeError, match="Insufficient memory"):
        await runtime_startup.persist_loaded_model_profile(profile, {"context_size": 512}, {})
    saved.assert_not_awaited()


@pytest.mark.asyncio
async def test_restart_uses_runtime_reduced_context_for_next_query(monkeypatch):
    profile = recommended_model_profile("owner/model.gguf", "gguf", None, 32768)
    profile.update(max_output_tokens=16000, history_token_budget=15000)
    config = {"type": "vyact", "vyact_config": {"model_path": profile["model_path"], "runtime": "gguf"}}
    monkeypatch.setattr(runtime_startup, "get_model_profile", AsyncMock(return_value=profile))
    monkeypatch.setattr(runtime_startup, "save_model_profile", AsyncMock(side_effect=lambda value: value))
    monkeypatch.setattr(runtime_startup, "save_config_async", AsyncMock())
    monkeypatch.setattr(runtime_startup, "load_ui_language_async", AsyncMock(return_value="ko"))
    monkeypatch.setattr(runtime_settings, "_settings", dict(runtime_settings.DEFAULT_RUNTIME_SETTINGS))
    def load_model(settings, debug, status):
        settings["context_size"] = 8192
        return "test-model"
    monkeypatch.setattr(runtime_startup, "start_configured_runtime", load_model)
    await runtime_startup.load_configured_vyact_model(config)
    settings = runtime_settings.get_runtime_settings()
    assert settings["llm_num_ctx"] == 8192
    assert settings["llm_num_predict"] == settings["llm_max_tokens"] == 7168
    assert settings["history_token_budget"] == 0
    assert config["vyact_config"]["context_size"] == 8192
