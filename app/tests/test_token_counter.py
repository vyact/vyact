from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.llm.token_counter import count_local_message_tokens


@pytest.mark.asyncio
async def test_local_tokenizer_failure_uses_common_tokenizer():
    messages = [{"role": "user", "content": "hello"}]

    with (
        patch(
            "services.llm.token_counter._count_llama_tokens",
            AsyncMock(side_effect=httpx.ConnectError("runtime unavailable")),
        ),
        patch(
            "services.llm.token_counter.count_cloud_message_tokens",
            return_value=17,
        ) as common_counter,
    ):
        token_count = await count_local_message_tokens(
            messages,
            {"runtime": "gguf"},
            None,
        )

    assert token_count == 17
    common_counter.assert_called_once_with(messages)
