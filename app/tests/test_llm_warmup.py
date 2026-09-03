from unittest.mock import AsyncMock, patch

import pytest

from services.llm.warmup import (
    CHAT_WARMUP_MAX_TOKENS,
    CHAT_WARMUP_USER_MESSAGE,
    warm_vyact_chat_prefix,
)


def _mock_http_client():
    response = AsyncMock()
    response.raise_for_status = lambda: None
    client = AsyncMock()
    client.post.return_value = response
    context = AsyncMock()
    context.__aenter__.return_value = client
    return context, client


@pytest.mark.asyncio
@pytest.mark.parametrize(("runtime", "expects_cache_prompt"), (("gguf", True), ("mlx", False)))
async def test_prefix_warmup_only_sends_llama_cache_prompt(runtime, expects_cache_prompt):
    context, client = _mock_http_client()
    runtime_settings = {"llm_max_tokens": 4096, "llm_temperature": 0.7}
    with patch("services.llm.warmup.httpx.AsyncClient", return_value=context), \
         patch("services.llm.warmup.get_runtime_settings", return_value=runtime_settings), \
         patch("services.llm.warmup.get_profile_text", new=AsyncMock(return_value="")), \
         patch("services.llm.warmup.mcp_manager.get_tools", new=AsyncMock(return_value=[])):
        assert await warm_vyact_chat_prefix(
            "model-id", "ko", "System prompt", runtime=runtime, raise_on_error=True,
        )

    payload = client.post.call_args.kwargs["json"]
    assert payload["max_tokens"] == CHAT_WARMUP_MAX_TOKENS
    assert "stop" not in payload
    assert payload["stream"] is True
    assert payload["messages"][-1]["content"] == CHAT_WARMUP_USER_MESSAGE
    if expects_cache_prompt:
        assert payload["cache_prompt"] is True
    else:
        assert "cache_prompt" not in payload
