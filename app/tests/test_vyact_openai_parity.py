import json
import unittest
from unittest.mock import AsyncMock, patch

from services.llm.providers import (
    _accumulate_llm_timing,
    _accumulate_openai_usage,
    _apply_local_prefix_cache_control,
    _apply_local_reasoning_control,
    _apply_local_seed,
    _apply_local_specprefill_control,
    _next_consecutive_tool_failures,
    _tool_call_fingerprint,
    _tool_call_max_rounds,
    openai_stream,
)


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
        self.stream_calls = 0

    def stream(self, _method, _url, *, headers, json):
        self.body = json
        self.stream_calls += 1
        return _StreamResponse()


class VyactOpenAiParityTests(unittest.IsolatedAsyncioTestCase):
    def test_accumulates_omlx_extended_usage_statistics(self):
        usage = {"_llm_call_count": 1}
        _accumulate_openai_usage(usage, {
            "prompt_tokens": 839,
            "completion_tokens": 75,
            "prompt_eval_duration": 45.72,
            "generation_duration": 5.36,
            "total_time": 51.08,
            "prompt_tokens_per_second": 18.35,
            "generation_tokens_per_second": 13.99,
            "prompt_tokens_details": {"cached_tokens": 512},
        })

        self.assertEqual(usage["prompt_tokens"], 839)
        self.assertEqual(usage["completion_tokens"], 75)
        self.assertEqual(usage["prompt_eval_duration"], 45_720_000_000)
        self.assertEqual(usage["eval_duration"], 5_360_000_000)
        self.assertEqual(usage["llm_total_duration"], 51_080_000_000)
        self.assertAlmostEqual(usage["completion_tokens_per_second"], 75 / 5.36)
        self.assertEqual(usage["cached_tokens"], 512)

    def test_tool_call_fingerprint_ignores_argument_key_order(self):
        first = _tool_call_fingerprint("search", {"query": "삼성전자", "page": 1})
        second = _tool_call_fingerprint("search", {"page": 1, "query": "삼성전자"})

        self.assertEqual(first, second)
        self.assertNotEqual(first, _tool_call_fingerprint("search", {"query": "SK하이닉스", "page": 1}))

    def test_cloud_and_local_tool_round_limits_are_separate(self):
        self.assertEqual(_tool_call_max_rounds({"is_local": True}), 30)
        self.assertEqual(_tool_call_max_rounds({"is_local": False}), 100)

    def test_consecutive_tool_failures_reset_after_success(self):
        failures = _next_consecutive_tool_failures(0, "[오류] 첫 번째 실패")
        failures = _next_consecutive_tool_failures(failures, "[tool 오류] 두 번째 실패")
        self.assertEqual(failures, 2)
        self.assertEqual(_next_consecutive_tool_failures(failures, "정상 결과"), 0)

    def test_llama_receives_explicit_prefix_cache_choice(self):
        body = {}

        _apply_local_prefix_cache_control(
            body, {"is_local": True, "runtime": "gguf"},
        )

        self.assertEqual(body, {"cache_prompt": True})

    def test_mlx_receives_explicit_reasoning_choice(self):
        body = {}
        _apply_local_reasoning_control(
            body, {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"}, reasoning=False,
        )

        self.assertEqual(body, {"chat_template_kwargs": {"enable_thinking": False}})

    def test_mlx_text_receives_reasoning_effort_through_omlx(self):
        body = {}
        _apply_local_reasoning_control(
            body, {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"}, reasoning="high",
        )

        self.assertEqual(body, {
            "chat_template_kwargs": {"enable_thinking": True},
            "reasoning_effort": "high",
        })

    def test_llama_receives_none_reasoning_effort(self):
        body = {}
        _apply_local_reasoning_control(
            body, {"is_local": True, "runtime": "gguf"}, reasoning="none",
        )
        self.assertEqual(body, {
            "chat_template_kwargs": {"enable_thinking": False},
            "reasoning_effort": "none",
        })

    def test_local_runtime_receives_configured_seed(self):
        body = {}
        with patch("services.llm.providers.get_runtime_settings", return_value={"seed": 42}):
            _apply_local_seed(body, {"is_local": True, "runtime": "mlx"})
        self.assertEqual(body, {"seed": 42})

    async def test_specprefill_is_enabled_at_token_threshold(self):
        body = {}
        with patch("services.mlx_runtime.get_downloaded_mlx_model_path", return_value="/model"), \
             patch("services.mlx_runtime.get_mlx_speculative_mode", return_value="specprefill"), \
             patch("services.llm.token_counter.count_local_message_tokens", new=AsyncMock(return_value=4096)):
            await _apply_local_specprefill_control(
                body, [{"role": "user", "content": "long"}],
                {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"},
                "chat:general_stream",
            )
        self.assertEqual(body, {
            "specprefill": True,
            "specprefill_keep_pct": 0.2,
            "specprefill_threshold": 1024,
        })

    async def test_specprefill_is_disabled_below_token_threshold(self):
        body = {}
        with patch("services.mlx_runtime.get_downloaded_mlx_model_path", return_value="/model"), \
             patch("services.mlx_runtime.get_mlx_speculative_mode", return_value="specprefill"), \
             patch("services.llm.token_counter.count_local_message_tokens", new=AsyncMock(return_value=1023)):
            await _apply_local_specprefill_control(
                body, [{"role": "user", "content": "short"}],
                {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"},
                "chat:general_stream",
            )
        self.assertEqual(body, {"specprefill": False})

    async def test_specprefill_uses_only_tokens_for_rag_code_and_exactness(self):
        body = {}
        tools = [{"type": "function", "function": {"name": "code_read_file"}}]
        with patch("services.mlx_runtime.get_downloaded_mlx_model_path", return_value="/model"), \
             patch("services.mlx_runtime.get_mlx_speculative_mode", return_value="specprefill"), \
             patch("services.llm.token_counter.count_local_message_tokens", new=AsyncMock(return_value=1024)):
            await _apply_local_specprefill_control(
                body, [{"role": "user", "content": "숫자를 정확히 인용해줘"}],
                {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"},
                "chat:selected_docs", tools,
            )
        self.assertTrue(body["specprefill"])

    async def test_specprefill_is_disabled_for_external_mtp_mode(self):
        body = {}
        with patch("services.mlx_runtime.get_downloaded_mlx_model_path", return_value="/model"), \
             patch("services.mlx_runtime.get_mlx_speculative_mode", return_value="external_mtp"):
            await _apply_local_specprefill_control(
                body, [{"role": "user", "content": "long"}],
                {"is_local": True, "runtime": "mlx", "model_path": "mlx/owner/model"},
                "chat:general_stream",
            )
        self.assertEqual(body, {"specprefill": False})

    def test_llm_total_accumulates_tool_judgment_and_final_call_timings(self):
        usage = {}

        _accumulate_llm_timing(usage, {
            "prompt_n": 1_000, "prompt_ms": 3_810,
            "predicted_n": 20, "predicted_ms": 410,
        })
        _accumulate_llm_timing(usage, {
            "prompt_n": 2_000, "prompt_ms": 3_820,
            "predicted_n": 500, "predicted_ms": 12_320,
        })

        self.assertEqual(usage["llm_total_duration"], 20_360_000_000)
        self.assertEqual(usage["prompt_eval_duration"], 7_630_000_000)
        self.assertEqual(usage["eval_duration"], 12_730_000_000)
        self.assertEqual(usage["prompt_tokens"], 3_000)
        self.assertEqual(usage["completion_tokens"], 520)
        self.assertAlmostEqual(usage["prompt_tokens_per_second"], 3_000 / 7.63)
        self.assertAlmostEqual(usage["completion_tokens_per_second"], 520 / 12.73)

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
        self.assertTrue(client.body["cache_prompt"])
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

    async def test_plain_answer_with_tools_uses_one_streaming_call(self):
        client = _Client()
        unified = [{"type": "function", "function": {
            "name": "browser_read", "description": "read", "parameters": {"type": "object", "properties": {}},
        }}]
        with patch("services.llm.providers.get_provider_config", AsyncMock(return_value={
                "type": "openai", "is_local": False, "model": "remote",
            })), patch("services.llm.providers._get_unified_tools", AsyncMock(return_value=(unified, ["browser_read"]))), \
                patch("services.llm.providers.build_tool_directive", AsyncMock(return_value="")):
            pieces = [piece async for piece in openai_stream(
                client, "remote", None, "system", "question", [], [], [], 30,
            )]

        self.assertEqual(pieces, ["ok"])
        self.assertEqual(client.stream_calls, 1)
        self.assertTrue(client.body["stream"])
        self.assertIn("tools", client.body)
