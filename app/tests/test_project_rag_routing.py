import unittest
from unittest.mock import AsyncMock, patch

import agent


async def _collect_stream(**kwargs):
    return [event async for event in agent.rag_query_stream("question", **kwargs)]


class ProjectRagRoutingTests(unittest.IsolatedAsyncioTestCase):
    async def test_general_ollama_chat_gathers_rag_before_tool_loop(self):
        observed = {}

        async def fake_stream(_question, docs, _system_prompt, _attachments, _history, **kwargs):
            observed["docs"] = docs
            observed["post_tool_docs"] = kwargs.get("post_tool_docs")
            yield {"type": "token", "text": "answer"}

        rag_docs = [{"title": "memo", "content": "context"}]
        with patch.object(agent, "get_provider_config", AsyncMock(return_value={"type": "ollama"})), \
                patch.object(agent, "_gather_docs", AsyncMock(return_value=rag_docs)) as gather_docs, \
                patch.object(agent, "chat_stream_with_tools", fake_stream), \
                patch.object(agent, "get_model_name", AsyncMock(return_value="model")):
            await _collect_stream(project_tool_first=False)

        gather_docs.assert_awaited_once()
        self.assertEqual(observed["docs"], rag_docs)
        self.assertIsNone(observed["post_tool_docs"])

    async def test_project_ollama_chat_defers_rag_and_code_tool_skips_it(self):
        observed = {}

        async def fake_stream(_question, docs, _system_prompt, _attachments, _history, **kwargs):
            observed["docs"] = docs
            post_tool_docs = kwargs.get("post_tool_docs")
            observed["post_tool_docs"] = post_tool_docs
            observed["post_result"] = await post_tool_docs(False, {"code_read_file"})
            yield {"type": "token", "text": "answer"}

        with patch.object(agent, "get_provider_config", AsyncMock(return_value={"type": "ollama"})), \
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


if __name__ == "__main__":
    unittest.main()
