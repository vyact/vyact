import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx

from services.llm.ollama import (
    _compact_tool_results,
    _encode_browser_inspect_for_model,
    _expire_previous_browser_inspections,
    _failure_call_key,
    _tool_decision_num_predict,
    resolve_tool_calls,
)
from services.llm.tools import build_tool_directive
from services.llm.config import (
    TOOL_CALL_DECISION_NUM_PREDICT,
    TOOL_CALL_MUTATION_NUM_PREDICT,
    TOOL_CALL_RETRY_RESULT_CHARS,
)
from services.llm.core import _apply_ollama_tool_loop_result


class _Response:
    status_code = 200

    def raise_for_status(self):
        return None

    def json(self):
        return {"message": {"content": "done", "tool_calls": []}}


class _Client:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *_args):
        return None

    async def post(self, *_args, **_kwargs):
        return _Response()


class _SequenceClient(_Client):
    def __init__(self):
        self.call_count = 0

    async def post(self, *_args, **_kwargs):
        self.call_count += 1
        if self.call_count == 1:
            request = httpx.Request("POST", "http://localhost:11434/api/chat")
            return httpx.Response(500, request=request)
        return _Response()


class OllamaToolRoundTests(unittest.IsolatedAsyncioTestCase):
    def test_browser_inspect_is_compacted_without_dropping_elements_or_fields(self):
        elements = [
            {
                "id": f"vyact-{index}",
                "tag": "a",
                "name": f"상품 {index}",
                "href": f"https://example.com/{index}",
            }
            for index in range(1, 21)
        ]
        original = json.dumps(elements, ensure_ascii=False)

        encoded = _encode_browser_inspect_for_model(original)
        table = json.loads(encoded)
        restored = [
            {column: value for column, value in zip(table["columns"], row) if value is not None}
            for row in table["rows"]
        ]

        self.assertEqual(restored, elements)
        self.assertLess(len(encoded), len(original))

    async def test_browser_directive_separates_candidate_research_from_actions(self):
        with patch(
            "services.mcp_config.get_active_mcp_prompt",
            AsyncMock(return_value=""),
        ):
            directive = await build_tool_directive([
                "browser_read_urls", "browser_open", "browser_inspect", "browser_click",
            ])

        self.assertIn("최소 2N개", directive)
        self.assertIn("후보 탐색·비교와 최종 변경 행동을 분리", directive)
        self.assertIn("읽은 모든 상품을 자동으로 선정된 상품으로 간주하지 마라", directive)

    def test_stale_browser_inspections_are_expired(self):
        messages = [
            {"role": "tool", "tool_name": "browser_inspect", "content": "large old DOM"},
            {"role": "tool", "tool_name": "browser_read", "content": "current page text"},
        ]

        _expire_previous_browser_inspections(messages)

        self.assertIn("expired browser_inspect", messages[0]["content"])
        self.assertEqual(messages[1]["content"], "current page text")

    def test_final_request_retains_tool_schema_for_prefix_cache(self):
        tools = [{"type": "function", "function": {"name": "browser_read"}}]
        messages = [{"role": "user", "content": "read the page"}]
        body = {"model": "test-model", "messages": []}

        _apply_ollama_tool_loop_result(body, {
            "messages": messages,
            "tools": tools,
        })

        self.assertIs(body["messages"], messages)
        self.assertIs(body["tools"], tools)

    def test_code_read_allows_a_larger_follow_up_patch(self):
        messages = [
            {"role": "assistant", "tool_calls": [{"function": {"name": "code_read_file"}}]},
            {"role": "tool", "content": "source"},
        ]
        self.assertEqual(_tool_decision_num_predict([]), TOOL_CALL_DECISION_NUM_PREDICT)
        self.assertEqual(_tool_decision_num_predict(messages), TOOL_CALL_MUTATION_NUM_PREDICT)

    def test_timeout_retry_compacts_large_tool_results(self):
        content = "a" * (TOOL_CALL_RETRY_RESULT_CHARS + 100)
        compacted = _compact_tool_results([{"role": "tool", "content": content}])
        self.assertLess(len(compacted[0]["content"]), len(content))
        self.assertIn("tool result shortened", compacted[0]["content"])

    def test_edit_failures_ignore_replacement_whitespace_changes(self):
        base_args = {
            "folder_id": "vyact",
            "path": "app/services/code_tools.py",
            "old_string": "IGNORE_DIRS = {\nitems\n}",
        }
        first_key = _failure_call_key(
            "code_edit_file", {**base_args, "new_string": "    items"}, "exact-1",
        )
        second_key = _failure_call_key(
            "code_edit_file", {**base_args, "new_string": "       items"}, "exact-2",
        )
        self.assertEqual(first_key, second_key)

    async def test_blocking_judgment_completes_with_wait_logger_enabled(self):
        tool = {"type": "function", "function": {
            "name": "code_create_file", "description": "create", "parameters": {},
        }}
        with patch("services.mcp_client.mcp_manager.get_ollama_tools", AsyncMock(return_value=[tool])), \
                patch("services.mcp_client.mcp_manager.has_tools", return_value=True), \
                patch("services.mcp_client.MCPManager.connected", new_callable=lambda: property(lambda _self: True)), \
                patch("services.llm.ollama.httpx.AsyncClient", return_value=_Client()), \
                patch("services.llm.ollama.log_tool_names", AsyncMock()), \
                patch("services.llm.ollama.build_tool_directive", AsyncMock(return_value="tools")):
            result = await resolve_tool_calls(
                "test-model", [{"role": "user", "content": "create"}], {}, timeout=1, max_rounds=1,
                reasoning=False,
            )
        self.assertEqual(result["direct_answer"], "done")
        self.assertEqual(result["tools"], [tool])

    async def test_transient_ollama_server_error_retries_tool_judgment(self):
        tool = {"type": "function", "function": {
            "name": "browser_read", "description": "read", "parameters": {},
        }}
        client = _SequenceClient()
        with patch("services.mcp_client.mcp_manager.get_ollama_tools", AsyncMock(return_value=[tool])), \
                patch("services.mcp_client.mcp_manager.has_tools", return_value=True), \
                patch("services.mcp_client.MCPManager.connected", new_callable=lambda: property(lambda _self: True)), \
                patch("services.llm.ollama.httpx.AsyncClient", return_value=client), \
                patch("services.llm.ollama.log_tool_names", AsyncMock()), \
                patch("services.llm.ollama.build_tool_directive", AsyncMock(return_value="tools")):
            result = await resolve_tool_calls(
                "test-model", [
                    {"role": "user", "content": "read"},
                    {"role": "tool", "content": "x" * (TOOL_CALL_RETRY_RESULT_CHARS + 100)},
                ], {}, timeout=1,
                max_rounds=1, reasoning=False,
            )

        self.assertEqual(client.call_count, 2)
        self.assertEqual(result["direct_answer"], "done")
        compacted_tool_message = next(
            message for message in result["messages"] if message.get("role") == "tool"
        )
        self.assertIn("tool result shortened", compacted_tool_message["content"])


if __name__ == "__main__":
    unittest.main()
