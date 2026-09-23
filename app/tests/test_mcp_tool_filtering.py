from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from services.code_tools import current_code_folder
from services.mcp_config import build_servers_config
from services.mcp_client import MCPManager, _Server, _cfg_key
from services.tool_approval import ApprovalContext, current_approval_context
from services.user_memory_tools import _list_memories, memory_write_stage
from mcp.types import Tool, ToolAnnotations


async def _handler(**_kwargs):
    return "ok"


def _tool(name: str):
    return SimpleNamespace(name=name, description=name, inputSchema={"type": "object", "properties": {}})


class McpToolFilteringTests(unittest.IsolatedAsyncioTestCase):
    async def test_personal_memory_tools_are_hidden_in_projects_or_when_disabled(self):
        manager = MCPManager()
        manager.register_internal_tool("user_memory_list", "memory", {}, _handler)
        manager.register_internal_tool("user_memory_save", "memory", {}, _handler)
        manager.register_internal_tool("user_memory_update", "memory", {}, _handler)
        manager.register_internal_tool("unrelated_tool", "other", {}, _handler)
        servers = AsyncMock(return_value=[])
        memory_state = AsyncMock(return_value={"enabled": True})
        with patch("services.mcp_config.list_servers", servers), \
                patch("services.user_memory_tools.get_memory_state", memory_state):
            self.assertEqual([tool["function"]["name"] for tool in await manager.get_tools()],
                             ["user_memory_list", "unrelated_tool"])
            stage_token = memory_write_stage.set(True)
            try:
                self.assertEqual([tool["function"]["name"] for tool in await manager.get_tools()],
                                 ["user_memory_save", "user_memory_update"])
            finally:
                memory_write_stage.reset(stage_token)
            token = current_approval_context.set(ApprovalContext(project_id="project"))
            try:
                self.assertEqual([tool["function"]["name"] for tool in await manager.get_tools()],
                                 ["unrelated_tool"])
            finally:
                current_approval_context.reset(token)
            memory_state.return_value = {"enabled": False}
            self.assertEqual([tool["function"]["name"] for tool in await manager.get_tools()],
                             ["unrelated_tool"])

    async def test_memory_list_execution_opens_write_stage_in_same_request(self):
        manager = MCPManager()
        manager.register_internal_tool("user_memory_list", "memory", {}, _list_memories)
        manager.register_internal_tool("user_memory_save", "memory", {}, _handler)
        manager.register_internal_tool("unrelated_tool", "other", {}, _handler)
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=[])), \
                patch("services.user_memory_tools.get_memory_state", AsyncMock(return_value={"enabled": True})), \
                patch("services.user_memory_tools.list_memories", AsyncMock(return_value=[{"id": "one"}])):
            token = memory_write_stage.set(False)
            try:
                result = await manager.call_tool("user_memory_list", {})
                self.assertIn('"id": "one"', result)
                self.assertEqual([tool["function"]["name"] for tool in await manager.get_tools()],
                                 ["user_memory_save"])
            finally:
                memory_write_stage.reset(token)

    def test_approval_metadata_comes_from_matching_server_and_explicit_hints(self):
        manager = MCPManager()
        manager._workers["Docs"] = SimpleNamespace(
            cfg={"trust_tool_annotations": True},
            server=_Server("Docs", None, [Tool(name="lookup", inputSchema={},
                annotations=ToolAnnotations(readOnlyHint=True))]),
        )
        self.assertEqual(manager.get_tool_approval_metadata("Docs__lookup"), {
            "annotations": {"readOnlyHint": True}, "annotations_trusted": True,
        })
        self.assertEqual(manager.get_tool_approval_metadata("Other__lookup"), {})
        self.assertEqual(manager.get_tool_approval_metadata("Docs__missing"), {})
        manager._workers["Docs"].cfg = {}
        self.assertFalse(manager.get_tool_approval_metadata("Docs__lookup")["annotations_trusted"])
        self.assertNotEqual(_cfg_key({}), _cfg_key({"trust_tool_annotations": True}))

    async def test_custom_transports_preserve_explicit_annotation_trust(self):
        for server_type, connection in (
            ("custom", {"command": "example-mcp"}),
            ("custom_remote", {"url": "https://example.test/mcp"}),
        ):
            for trusted in (True, False, "true", None):
                with self.subTest(server_type=server_type, trusted=trusted):
                    config = {"name": "Example", **connection, "trust_tool_annotations": trusted}
                    server = {"id": "example", "type": server_type, "enabled": True, "config": config}
                    with patch("services.mcp_config.list_servers", AsyncMock(return_value=[server])):
                        connections = await build_servers_config()
                    self.assertEqual(len(connections), 1)
                    self.assertIs(next(iter(connections.values()))["trust_tool_annotations"], trusted is True)

    async def test_disabled_internal_tools_are_not_exposed(self):
        manager = MCPManager()
        manager.register_internal_tool(
            "search_emails", "email", {}, _handler, server_type="google_workspace",
        )
        manager.register_internal_tool(
            "code_read_file", "code", {}, _handler, server_type="code_tools",
        )
        servers = [
            {"id": "google", "type": "google_workspace", "enabled": False},
            {"id": "code", "type": "code_tools", "enabled": True},
        ]
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=servers)):
            tools = await manager.get_tools()
        self.assertEqual([tool["function"]["name"] for tool in tools], ["code_read_file"])

    async def test_disabled_browser_tools_are_not_exposed(self):
        manager = MCPManager()
        manager.register_internal_tool("browser_read", "browser", {}, _handler, server_type="browser")
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=[
            {"id": "browser", "type": "browser", "enabled": False},
        ])):
            tools = await manager.get_tools()
        self.assertEqual(tools, [])

    async def test_disabled_external_worker_is_filtered_before_llm_exposure(self):
        manager = MCPManager()
        worker = SimpleNamespace(
            cfg={"_server_id": "disabled-server", "_server_type": "custom"},
            server=_Server("stale", None, [_tool("dangerous_tool")]),
        )
        manager._workers["stale"] = worker
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=[
            {"id": "disabled-server", "type": "custom", "enabled": False},
        ])):
            tools = await manager.get_tools()
        self.assertEqual(tools, [])

    async def test_explicit_request_scope_can_expose_an_off_server(self):
        manager = MCPManager()
        manager.register_internal_tool(
            "search_emails", "email", {}, _handler, server_type="google_workspace",
        )
        manager._google_authenticated = True
        server = {"id": "google", "type": "google_workspace", "enabled": False}
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=[server])), \
                patch("services.mcp_config.build_servers_config", AsyncMock(return_value={})):
            tokens = await manager.enable_request_scope(["google"])
            try:
                tools = await manager.get_tools()
            finally:
                manager.reset_request_scope(tokens)
        self.assertEqual([tool["function"]["name"] for tool in tools], ["search_emails"])

    async def test_explicit_mcp_selection_keeps_project_code_tools(self):
        manager = MCPManager()
        manager.register_internal_tool(
            "search_emails", "email", {}, _handler, server_type="google_workspace",
        )
        manager.register_internal_tool(
            "code_read_file", "code", {}, _handler, server_type="code_tools",
        )
        manager._google_authenticated = True
        server = {"id": "google", "type": "google_workspace", "enabled": False}
        folder_token = current_code_folder.set("/tmp/project")
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=[server])), \
                patch("services.mcp_config.build_servers_config", AsyncMock(return_value={})):
            scope_tokens = await manager.enable_request_scope(["google"])
            try:
                tools = await manager.get_tools()
            finally:
                manager.reset_request_scope(scope_tokens)
                current_code_folder.reset(folder_token)
        self.assertEqual(
            [tool["function"]["name"] for tool in tools],
            ["search_emails", "code_read_file"],
        )


if __name__ == "__main__":
    unittest.main()
