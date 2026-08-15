from types import SimpleNamespace
import unittest
from unittest.mock import AsyncMock, patch

from services.mcp_client import MCPManager, _Server


async def _handler(**_kwargs):
    return "ok"


def _tool(name: str):
    return SimpleNamespace(name=name, description=name, inputSchema={"type": "object", "properties": {}})


class McpToolFilteringTests(unittest.IsolatedAsyncioTestCase):
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
            tools = await manager.get_ollama_tools()
        self.assertEqual([tool["function"]["name"] for tool in tools], ["code_read_file"])

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
            tools = await manager.get_ollama_tools()
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
                tools = await manager.get_ollama_tools()
            finally:
                manager.reset_request_scope(tokens)
        self.assertEqual([tool["function"]["name"] for tool in tools], ["search_emails"])


if __name__ == "__main__":
    unittest.main()
