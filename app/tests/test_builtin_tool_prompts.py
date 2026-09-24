import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services import mcp_config
from services.filesystem_prompts import FILESYSTEM_PROMPTS, get_filesystem_prompt
from services.llm import tools as llm_tools
from services.mcp_client import MCPManager, mcp_manager


@pytest.mark.parametrize("language", FILESYSTEM_PROMPTS)
def test_filesystem_prompt_matches_settings_default(language):
    settings = Path(__file__).resolve().parents[2] / "frontend/src/i18n/locales" / language / "settings.json"
    localized = json.loads(settings.read_text())["mcpDefaultPrompts"]["filesystem"]
    assert localized == get_filesystem_prompt(language)


def test_exposed_server_scopes_identifies_external_and_internal_tools():
    manager = MCPManager()
    manager._workers["Files"] = SimpleNamespace(
        server=SimpleNamespace(name="Files"), cfg={"_server_id": "filesystem-server"},
    )
    manager._internal_tools["browser_read"] = {"server_type": "browser"}
    assert manager.exposed_server_scopes(["Files__read_text_file", "browser_read"]) == (
        {"filesystem-server"}, {"browser"},
    )
    assert manager.exposed_server_scopes(["code_read_file"]) == (set(), set())


def test_old_stock_prompts_upgrade_without_overwriting_user_edits():
    old_github = (
        "GitHub Code Changes and Pull Request Rules\n"
        "When asked to change code in a GitHub repository or create a pull request:\n"
        "1. Use get_file_contents to inspect the current file and SHA.\n"
        "2. Create a working branch with create_branch from the default branch.\n"
        "3. Commit changes with create_or_update_file, passing the previously retrieved SHA. Use push_files for multiple files.\n"
        "4. Create the pull request with create_pull_request and clearly describe what changed and why.\n\n"
        "Always inspect files before changing them, show the proposed changes before committing, and use list_branches when the default branch is unknown. For code-review requests, review the retrieved code without modifying it."
    )
    config = {"servers": [
        {"type": "github", "prompt": old_github},
        {"type": "github", "prompt": old_github + " My own instruction."},
    ]}
    assert mcp_config._clear_legacy_default_prompts(config)
    assert config["servers"][0]["prompt"] == ""
    assert config["servers"][1]["prompt"].endswith("My own instruction.")
    assert not mcp_config._clear_legacy_default_prompts(config)


@pytest.mark.asyncio
async def test_only_exposed_server_prompts_are_injected(monkeypatch):
    servers = [
        {"id": "files", "type": "filesystem", "enabled": True, "prompt": ""},
        {"id": "web", "type": "web_search", "enabled": True, "prompt": "Custom search rule"},
    ]
    monkeypatch.setattr(mcp_config, "list_servers", AsyncMock(return_value=servers))
    monkeypatch.setattr(mcp_config, "get_tool_language", AsyncMock(return_value="ko-KR"))
    monkeypatch.setattr(mcp_manager, "exposed_server_scopes", lambda names: (
        {"files"} if "Files__read_text_file" in names else set(), set(),
    ))
    prompt = await mcp_config.get_active_mcp_prompt(available_tool_names=["Files__read_text_file"])
    assert prompt == get_filesystem_prompt("ko")
    assert await mcp_config.get_active_mcp_prompt(available_tool_names=["code_read_file"]) == ""
    servers[0]["prompt"] = "Custom filesystem rule"
    assert await mcp_config.get_active_mcp_prompt(available_tool_names=["Files__read_text_file"]) == "Custom filesystem rule"


@pytest.mark.asyncio
async def test_selected_unavailable_tool_does_not_force_a_call(monkeypatch):
    monkeypatch.setattr(mcp_manager, "has_request_scope", lambda: True)
    monkeypatch.setattr(mcp_manager, "get_request_scope_server_ids", lambda: {"files"})
    monkeypatch.setattr(mcp_manager, "get_request_scope_server_types", lambda: {"filesystem"})
    monkeypatch.setattr(mcp_manager, "exposed_server_scopes", lambda names: (set(), set()))
    monkeypatch.setattr(mcp_config, "get_active_mcp_prompt", AsyncMock(return_value=""))
    directive = await llm_tools.build_tool_directive(["browser_read"])
    assert "선택한 도구 사용 불가" in directive
    assert "선택한 도구를 먼저 호출" not in directive
    assert "browser_inspect" in directive


@pytest.mark.asyncio
async def test_browser_rules_only_appear_with_browser_tool(monkeypatch):
    monkeypatch.setattr(mcp_manager, "has_request_scope", lambda: False)
    monkeypatch.setattr(mcp_config, "get_active_mcp_prompt", AsyncMock(return_value=""))
    browser = await llm_tools.build_tool_directive(["browser_read"])
    filesystem = await llm_tools.build_tool_directive(["Files__read_text_file"])
    assert "browser_ask_user" in browser
    assert "브라우저 도구" not in filesystem
    assert len(browser) < 1600
