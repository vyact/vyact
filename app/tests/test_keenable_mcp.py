from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from mcp.types import Tool, ToolAnnotations

import pytest

from services import mcp_config
from routers.mcp import _mask
from services.mcp_client import MCPManager
from services.tool_approval import requires_approval


def test_keenable_default_and_migration_preserve_user_choices():
    cfg = mcp_config._default_config()
    server = next(s for s in cfg["servers"] if s["type"] == "keenable")
    assert server["enabled"] is True
    server["enabled"] = False
    assert mcp_config._ensure_builtin_servers(cfg)[1] is False
    assert server["enabled"] is False
    cfg["servers"].remove(server)
    cfg["removed_builtin_server_types"] = ["keenable"]
    assert mcp_config._ensure_builtin_servers(cfg)[1] is False


@pytest.mark.asyncio
@pytest.mark.parametrize("api_key", ["", "test-key"])
async def test_keenable_remote_config_and_secret_masking(api_key):
    server = {"id": "keen", "type": "keenable", "enabled": True,
              "config": {"api_key": api_key}}
    with patch.object(mcp_config, "list_servers", AsyncMock(return_value=[server])):
        config = next(iter((await mcp_config.build_servers_config()).values()))
    assert config["url"] == mcp_config.KEENABLE_MCP_URL
    assert config["transport"] == "streamable_http"
    assert config["trust_tool_annotations"] is True
    assert config["tool_whitelist"] == ["search_web_pages", "fetch_page_content"]
    manager = MCPManager()
    manager._workers["keenable_keen"] = SimpleNamespace(cfg=config, server=SimpleNamespace(tools=[
        Tool(name=name, inputSchema={}, annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False))
        for name in config["tool_whitelist"]
    ]))
    for name in config["tool_whitelist"]:
        full_name = f"keenable_keen__{name}"
        metadata = manager.get_tool_approval_metadata(full_name)
        for mode in ("risky_only", "always_confirm"):
            assert not requires_approval(full_name, mode, **metadata)
    # Unrecognized or destructive metadata never inherits a blanket exemption.
    assert requires_approval("keenable_keen__unknown", "risky_only", annotations_trusted=True)
    assert requires_approval("keenable_keen__delete_file", "risky_only", {"readOnlyHint": True}, True)
    assert config["headers"]["X-Keenable-Title"] == "Vyact"
    assert config["headers"].get("X-API-Key", "") == api_key
    if api_key:
        assert _mask([server])[0]["config"]["api_key"] == "********"
        assert server["config"]["api_key"] == api_key


@pytest.mark.asyncio
async def test_deleted_keenable_stays_deleted():
    cfg = mcp_config._default_config()
    server = next(s for s in cfg["servers"] if s["type"] == "keenable")
    with patch.object(mcp_config, "load_mcp_config", AsyncMock(return_value=cfg)), \
            patch.object(mcp_config, "save_mcp_config", AsyncMock()):
        await mcp_config.remove_server(server["id"])
    assert "keenable" in cfg["removed_builtin_server_types"]
    assert mcp_config._ensure_builtin_servers(cfg)[1] is False
