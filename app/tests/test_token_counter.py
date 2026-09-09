from unittest.mock import AsyncMock, patch

import httpx
import pytest
from jinja2 import Environment, StrictUndefined
from jinja2.exceptions import UndefinedError

from services.llm.token_counter import IMAGE_INPUT_TOKEN_RESERVE, _count_mlx_tokens, count_local_message_tokens


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


def test_mlx_token_count_excludes_base64_image_payload():
    class Tokenizer:
        def apply_chat_template(self, messages, **_kwargs):
            content = messages[-1]["content"]
            assert "base64-data" not in content
            assert "where is this?" in content
            return list(range(12))

    messages = [{
        "role": "user",
        "content": [
            {"type": "text", "text": "where is this?"},
            {"type": "image_url", "image_url": {"url": "data:image/jpeg;base64," + "base64-data" * 1000}},
        ],
    }]
    with patch("services.llm.token_counter._load_mlx_tokenizer", return_value=Tokenizer()):
        token_count = _count_mlx_tokens("mlx/model", messages, None)

    assert token_count == 12 + IMAGE_INPUT_TOKEN_RESERVE


def test_mlx_batch_encoding_counts_input_ids_instead_of_mapping_keys():
    class Tokenizer:
        def apply_chat_template(self, _messages, **_kwargs):
            return {"input_ids": list(range(20)), "attention_mask": [1] * 20}

    with patch("services.llm.token_counter._load_mlx_tokenizer", return_value=Tokenizer()):
        token_count = _count_mlx_tokens(
            "mlx/model", [{"role": "user", "content": "hello"}], None,
        )

    assert token_count == 20


def test_mlx_tool_count_preserves_openai_function_wrapper():
    template = Environment(undefined=StrictUndefined).from_string(
        "{% for tool in tools %}{{ tool.function.name }}{% endfor %}"
    )
    class Tokenizer:
        def apply_chat_template(self, messages, **kwargs):
            assert template.render(tools=kwargs["tools"]) == "code_read_file"
            return [1, 2, 3]
    tools = [{"type": "function", "function": {"name": "code_read_file", "parameters": {"type": "object"}}}]
    with patch("services.llm.token_counter._load_mlx_tokenizer", return_value=Tokenizer()):
        assert _count_mlx_tokens("mlx/model", [{"role": "user", "content": "read"}], tools) == 3


@pytest.mark.asyncio
async def test_mlx_template_failure_falls_back_with_tool_schema():
    tools = [{"type": "function", "function": {"name": "code_read_file"}}]
    messages = [{"role": "user", "content": "read"}]
    with (
        patch("services.llm.token_counter._count_mlx_tokens", side_effect=UndefinedError("template mismatch")),
        patch("services.llm.token_counter.count_cloud_message_tokens", return_value=25) as counter,
    ):
        assert await count_local_message_tokens(messages, {"runtime": "mlx", "model_path": "mlx/model"}, tools) == 25
    assert "code_read_file" in counter.call_args.args[0][-1]["content"]
    assert counter.call_args.args[0][0] == messages[0]
