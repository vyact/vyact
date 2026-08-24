import json
import unittest
from unittest.mock import AsyncMock, patch

from services.llm.providers import _accumulate_llm_timing, openai_stream


class _StreamResponse:
    def __init__(self):
        self.status_code = 200

    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    def raise_for_status(self):
        return None

    async def aiter_lines(self):
        yield f"data: {json.dumps({'choices': [{'delta': {'content': 'ok'}, 'finish_reason': 'stop'}]})}"
        yield "data: [DONE]"


class _Client:
    def __init__(self):
        self.body = None

    def stream(self, _method, _url, *, headers, json):
        self.body = json
        return _StreamResponse()


class VyactOpenAiParityTests(unittest.IsolatedAsyncioTestCase):
    def test_llm_total_accumulates_tool_judgment_and_final_call_timings(self):
        usage = {}

        _accumulate_llm_timing(usage, {"prompt_ms": 3_810, "predicted_ms": 410})
        _accumulate_llm_timing(usage, {"prompt_ms": 3_820, "predicted_ms": 12_320})

        self.assertEqual(usage["llm_total_duration"], 20_360_000_000)

    async def test_llama_stream_receives_reasoning_and_runtime_options(self):
        client = _Client()
        with patch("services.llm.providers.get_provider_config", AsyncMock(return_value={
                "type": "openai", "selection_type": "vyact", "is_local": True,
                "runtime": "gguf", "model": "local", "base_url": "http://127.0.0.1:11435/v1",
            })), patch("services.llm.providers._get_unified_tools", AsyncMock(return_value=([], []))):
            pieces = [piece async for piece in openai_stream(
                client, "local", None, "system", "question", [], [], [], 30,
                reasoning=False,
            )]

        self.assertEqual(pieces, ["ok"])
        self.assertEqual(client.body["chat_template_kwargs"], {"enable_thinking": False})
        self.assertIn("max_tokens", client.body)

    async def test_structured_output_uses_llama_json_schema(self):
        client = _Client()
        schema = {"type": "object", "properties": {"answer": {"type": "string"}}}
        with patch("services.llm.providers.get_provider_config", AsyncMock(return_value={
                "type": "openai", "selection_type": "vyact", "is_local": True,
                "runtime": "gguf", "model": "local", "base_url": "http://127.0.0.1:11435/v1",
            })), patch("services.llm.providers._get_unified_tools", AsyncMock(return_value=([], []))):
            _ = [piece async for piece in openai_stream(
                client, "local", None, "system", "question", [], [], [], 30,
                structured_output_schema=schema,
            )]

        self.assertEqual(client.body["response_format"]["json_schema"]["schema"], schema)
