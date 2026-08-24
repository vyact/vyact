import unittest
from unittest.mock import AsyncMock, patch

import agent


async def _collect_stream(**kwargs):
    return [event async for event in agent.rag_query_stream("question", **kwargs)]


class ProjectRagRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_isolated_prompt_skips_rag_and_forwards_no_injection_flags(self):
        observed = {}

        async def fake_stream(_question, docs, system_prompt, _attachments, history, **kwargs):
            observed["docs"] = docs
            observed["system_prompt"] = system_prompt
            observed["history"] = history
            observed["kwargs"] = kwargs
            yield {"type": "token", "text": "answer"}

        with patch.object(agent, "get_provider_config", AsyncMock(return_value={"type": "openai"})), \
                patch.object(agent, "_gather_docs", AsyncMock()) as gather_docs, \
                patch.object(agent, "chat_stream_with_tools", fake_stream), \
                patch.object(agent, "get_model_name", AsyncMock(return_value="model")):
            await _collect_stream(
                system_prompt="PLUGIN_SYSTEM_PROMPT",
                conversation_history=[],
                skip_rag=True,
                conversation_summary="",
                format_instruction_override="",
                inject_user_profile=False,
                use_tools=False,
                include_skills=False,
                isolated_system_prompt=True,
            )

        gather_docs.assert_not_awaited()
        self.assertEqual(observed["docs"], [])
        self.assertEqual(observed["system_prompt"], "PLUGIN_SYSTEM_PROMPT")
        self.assertEqual(observed["history"], [])
        self.assertFalse(observed["kwargs"]["inject_user_profile"])
        self.assertFalse(observed["kwargs"]["use_tools"])
        self.assertFalse(observed["kwargs"]["include_skills"])
        self.assertTrue(observed["kwargs"]["isolated_system_prompt"])
        self.assertEqual(observed["kwargs"]["conversation_summary"], "")
        self.assertEqual(observed["kwargs"]["format_instruction_override"], "")

    async def test_general_cloud_chat_gathers_rag_before_tool_loop(self):
        observed = {}

        async def fake_stream(_question, docs, _system_prompt, _attachments, _history, **kwargs):
            observed["docs"] = docs
            observed["post_tool_docs"] = kwargs.get("post_tool_docs")
            yield {"type": "token", "text": "answer"}

        rag_docs = [{"title": "memo", "content": "context"}]
        with patch.object(agent, "get_provider_config", AsyncMock(return_value={"type": "openai"})), \
                patch.object(agent, "_gather_docs", AsyncMock(return_value=rag_docs)) as gather_docs, \
                patch.object(agent, "chat_stream_with_tools", fake_stream), \
                patch.object(agent, "get_model_name", AsyncMock(return_value="model")):
            await _collect_stream(project_tool_first=False)

        gather_docs.assert_awaited_once()
        self.assertEqual(observed["docs"], rag_docs)
        self.assertIsNone(observed["post_tool_docs"])

    async def test_project_vyact_code_tool_skips_deferred_rag(self):
        observed = {}

        async def fake_stream(_question, docs, _system_prompt, _attachments, _history, **kwargs):
            observed["docs"] = docs
            post_tool_docs = kwargs.get("post_tool_docs")
            observed["post_tool_docs"] = post_tool_docs
            observed["post_result"] = await post_tool_docs(False, {"code_read_file"})
            yield {"type": "token", "text": "answer"}

        with patch.object(agent, "get_provider_config", AsyncMock(return_value={"type": "openai", "selection_type": "vyact"})), \
                patch.object(agent, "_gather_docs", AsyncMock()) as gather_docs, \
                patch.object(agent, "_gather_related_context", AsyncMock()) as gather_related, \
                patch.object(agent, "chat_stream_with_tools", fake_stream), \
                patch.object(agent, "get_model_name", AsyncMock(return_value="model")):
            await _collect_stream(project_tool_first=True)

        gather_docs.assert_not_awaited()
        gather_related.assert_not_awaited()
        self.assertEqual(observed["docs"], [])
        self.assertIsNotNone(observed["post_tool_docs"])
        self.assertEqual(observed["post_result"], [])

    async def test_project_vyact_chat_uses_the_same_deferred_rag_path(self):
        observed = {}

        async def fake_stream(_question, docs, _system_prompt, _attachments, _history, **kwargs):
            observed["docs"] = docs
            observed["post_tool_docs"] = kwargs.get("post_tool_docs")
            yield {"type": "token", "text": "answer"}

        with patch.object(agent, "get_provider_config", AsyncMock(return_value={
                "type": "openai", "selection_type": "vyact",
            })), patch.object(agent, "_gather_docs", AsyncMock()) as gather_docs, \
                patch.object(agent, "chat_stream_with_tools", fake_stream), \
                patch.object(agent, "get_model_name", AsyncMock(return_value="model")):
            await _collect_stream(project_tool_first=True)

        gather_docs.assert_not_awaited()
        self.assertEqual(observed["docs"], [])
        self.assertIsNotNone(observed["post_tool_docs"])


if __name__ == "__main__":
    unittest.main()
