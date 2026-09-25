from unittest.mock import AsyncMock, patch

import pytest

from services.code_tools import current_code_folders, register_code_tools
from services.filesystem_tools import allowed_filesystem_folders, register_filesystem_tools
from services.mcp_config import build_servers_config
from services.mcp_client import mcp_manager
from services.tool_approval import get_tool_risk


@pytest.mark.asyncio
async def test_internal_filesystem_tools_reuse_project_operations_and_stay_in_allowed_root(tmp_path):
    allowed = tmp_path / "allowed"
    allowed.mkdir()
    outside = tmp_path / "outside.txt"
    outside.write_text("private")
    (allowed / "note.txt").write_text("before")
    (allowed / "escape.txt").symlink_to(outside)
    servers = [{"id": "files", "type": "filesystem", "enabled": True,
                "config": {"directories": [str(allowed)]}}]
    register_code_tools()
    register_filesystem_tools()
    project_token = current_code_folders.set({"project": str(tmp_path)})
    try:
        with patch("services.mcp_config.list_servers", AsyncMock(return_value=servers)):
            folders = await allowed_filesystem_folders()
            folder_id = next(iter(folders))
            assert await build_servers_config() == {}
            offered = {tool["function"]["name"] for tool in await mcp_manager.get_tools()}
            assert "filesystem_read_file" in offered
            assert "filesystem_edit_file" in offered
            assert "filesystem_create_file" in offered
            assert "filesystem_read_file" in mcp_manager._internal_tools
            assert get_tool_risk("filesystem_read_file") == "read"
            assert get_tool_risk("filesystem_edit_file") == "write"
            read = await mcp_manager.call_tool("filesystem_read_file", {"folder_id": folder_id, "path": "note.txt"})
            assert "before" in read
            denied = await mcp_manager.call_tool("filesystem_read_file", {"folder_id": folder_id, "path": "escape.txt"})
            assert "private" not in denied
            edited = await mcp_manager.call_tool("filesystem_edit_file", {
                "folder_id": folder_id, "path": "note.txt", "old_string": "before", "new_string": "after",
            })
            assert "after" == (allowed / "note.txt").read_text()
            assert "✅" in edited
            assert current_code_folders.get() == {"project": str(tmp_path)}
    finally:
        current_code_folders.reset(project_token)


@pytest.mark.asyncio
async def test_disabled_filesystem_has_no_exposed_tools_or_allowed_roots(tmp_path):
    register_code_tools()
    register_filesystem_tools()
    servers = [{"id": "files", "type": "filesystem", "enabled": False,
                "config": {"directories": [str(tmp_path)]}}]
    with patch("services.mcp_config.list_servers", AsyncMock(return_value=servers)):
        assert await allowed_filesystem_folders() == {}
        offered = {tool["function"]["name"] for tool in await mcp_manager.get_tools()}
        assert "filesystem_read_file" not in offered


@pytest.mark.asyncio
async def test_explicitly_selected_filesystem_exposes_internal_tools_without_connection(tmp_path):
    register_code_tools()
    register_filesystem_tools()
    servers = [{"id": "files", "type": "filesystem", "enabled": False,
                "config": {"directories": [str(tmp_path)]}}]
    with patch("services.mcp_config.list_servers", AsyncMock(return_value=servers)):
        scope = await mcp_manager.enable_request_scope(["files"])
        try:
            assert await build_servers_config({"files"}) == {}
            offered = {tool["function"]["name"] for tool in await mcp_manager.get_tools()}
            assert "filesystem_read_file" in offered
        finally:
            mcp_manager.reset_request_scope(scope)
