from unittest.mock import AsyncMock, patch

import pytest

from services.llm.warmup import warm_vyact_chat_prefix, warm_vyact_model_compile


def _mock_http_client():
    response = AsyncMock()
    response.raise_for_status = lambda: None
    client = AsyncMock()
    client.post.return_value = response
    context = AsyncMock()
    context.__aenter__.return_value = client
    return context, client


@pytest.mark.asyncio
async def test_model_compile_warmup_uses_minimal_request():
    context, client = _mock_http_client()
    with patch("services.llm.warmup.httpx.AsyncClient", return_value=context):
        assert await warm_vyact_model_compile("model-id", raise_on_error=True)

    payload = client.post.call_args.kwargs["json"]
    assert payload["max_tokens"] == 1
    assert payload["messages"] == [{"role": "user", "content": "."}]
    assert "cache_prompt" not in payload


@pytest.mark.asyncio
@pytest.mark.parametrize(("runtime", "expects_cache_prompt"), (("gguf", True), ("mlx", False)))
async def test_prefix_warmup_only_sends_llama_cache_prompt(runtime, expects_cache_prompt):
    context, client = _mock_http_client()
    with patch("services.llm.warmup.httpx.AsyncClient", return_value=context), \
         patch("services.llm.warmup.get_profile_text", new=AsyncMock(return_value="")), \
         patch("services.llm.warmup.mcp_manager.get_tools", new=AsyncMock(return_value=[])):
        assert await warm_vyact_chat_prefix(
            "model-id", "ko", "System prompt", runtime=runtime, raise_on_error=True,
        )

    payload = client.post.call_args.kwargs["json"]
    if expects_cache_prompt:
        assert payload["cache_prompt"] is True
    else:
        assert "cache_prompt" not in payload
