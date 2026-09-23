import json
from unittest.mock import AsyncMock

import pytest

from services import user_memory_tools
from services import user_memory
from services.tool_approval import ApprovalContext, current_approval_context


@pytest.mark.asyncio
async def test_memory_tools_require_ordinary_chat_and_enabled_setting(monkeypatch):
    save = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "save_memory", save)
    state = AsyncMock(return_value=True)
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", state)

    token = current_approval_context.set(ApprovalContext(project_id="project"))
    try:
        assert not await user_memory_tools.user_memory_tools_available()
        result = json.loads(await user_memory_tools._save_memory("A preference", "PREFERENCE"))
        assert result["ok"] is False
        save.assert_not_awaited()
    finally:
        current_approval_context.reset(token)

    state.return_value = False
    assert not await user_memory_tools.user_memory_tools_available()
    list_memories = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "list_memories", list_memories)
    listed = json.loads(await user_memory_tools._list_memories())
    assert listed["ok"] is False
    assert user_memory_tools.memory_write_stage.get() is False
    list_memories.assert_not_awaited()
    result = json.loads(await user_memory_tools._delete_memory("id"))
    assert result["ok"] is False


@pytest.mark.asyncio
async def test_selected_tool_scope_does_not_inject_unavailable_memory_instruction(monkeypatch):
    from services.mcp_client import mcp_manager

    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    monkeypatch.setattr(mcp_manager, "get_request_scope_server_ids", lambda: {"selected"})
    assert not await user_memory_tools.user_memory_tools_available()


@pytest.mark.asyncio
async def test_memory_setting_is_fixed_for_the_current_turn(monkeypatch):
    state = AsyncMock(return_value={"enabled": False})
    monkeypatch.setattr(user_memory, "get_memory_state", state)
    monkeypatch.setattr(user_memory_tools, "list_memories", AsyncMock(return_value=[]))

    on_token = user_memory.memory_enabled_for_turn.set(True)
    try:
        assert await user_memory_tools.user_memory_tools_available()
        assert json.loads(await user_memory_tools._list_memories())["ok"] is True
        state.assert_not_awaited()
    finally:
        user_memory.memory_enabled_for_turn.reset(on_token)
        user_memory_tools.reset_memory_stages()

    off_token = user_memory.memory_enabled_for_turn.set(False)
    state.return_value = {"enabled": True}
    try:
        assert not await user_memory_tools.user_memory_tools_available()
        assert json.loads(await user_memory_tools._list_memories())["ok"] is False
        state.assert_not_awaited()
    finally:
        user_memory.memory_enabled_for_turn.reset(off_token)


@pytest.mark.asyncio
async def test_memory_list_prioritizes_related_items_within_token_budget(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    monkeypatch.setattr(user_memory_tools, "list_memories", AsyncMock(return_value=[
        {"id": "unrelated", "category": "Cooking", "content": "Prefers Italian recipes " * 20},
        {"id": "study", "category": "English study", "content": "Continue past perfect grammar " * 20},
    ]))

    async def fake_tokenize(text, _config):
        return list(range(len(text))), None

    monkeypatch.setattr(user_memory_tools, "tokenize_text_for_provider", fake_tokenize)
    budget_token = user_memory_tools.memory_list_token_budget.set(900)
    try:
        result = json.loads(await user_memory_tools._list_memories(candidate="English study progress"))
        assert result["total_count"] == 2
        assert result["omitted_count"] == 1
        assert [item["id"] for item in result["memories"]] == ["study"]
        user_memory_tools.reset_memory_stages()
        user_memory_tools.memory_list_token_budget.set(550)
        too_small = json.loads(await user_memory_tools._list_memories(candidate="English study progress"))
        assert too_small["ok"] is False
        assert not user_memory_tools.active_memory_stage_tools()
    finally:
        user_memory_tools.memory_list_token_budget.reset(budget_token)
        user_memory_tools.reset_memory_stages()


@pytest.mark.asyncio
async def test_memory_list_does_not_open_write_stage_without_room_for_review(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    memories = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "list_memories", memories)
    budget_token = user_memory_tools.memory_list_token_budget.set(100)
    try:
        result = json.loads(await user_memory_tools._list_memories(candidate="English study"))
        assert result["ok"] is False
        assert not user_memory_tools.active_memory_stage_tools()
        memories.assert_not_awaited()
    finally:
        user_memory_tools.memory_list_token_budget.reset(budget_token)


@pytest.mark.asyncio
async def test_memory_tool_saves_once_and_uses_conversation_id(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    existing = []
    monkeypatch.setattr(user_memory_tools, "list_memories", AsyncMock(side_effect=lambda: existing))
    save = AsyncMock(return_value={"id": "one", "content": "Prefers concise answers"})
    monkeypatch.setattr(user_memory_tools, "save_memory", save)

    token = current_approval_context.set(ApprovalContext(conversation_id="chat"))
    try:
        await user_memory_tools._list_memories()
        result = json.loads(await user_memory_tools._save_memory(
            "Prefers concise answers", "PREFERENCE", "Response style"))
        assert result["memory"]["id"] == "one"
        save.assert_awaited_once_with("Prefers concise answers", "PREFERENCE", "Response style",
                                    source_conv_id="chat")
        existing.append({"id": "one", "content": "Prefers concise answers"})
        result = json.loads(await user_memory_tools._save_memory(
            "Prefers concise answers", "PREFERENCE", "Response style"))
        assert result["unchanged"] is True
        save.assert_awaited_once()
    finally:
        user_memory_tools.memory_write_stage.set(False)
        current_approval_context.reset(token)


@pytest.mark.asyncio
async def test_memory_save_returns_existing_topic_for_review_instead_of_duplicating(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    monkeypatch.setattr(user_memory_tools, "list_memories", AsyncMock(return_value=[{
        "id": "study", "memory_type": "LEARNING", "category": "English progress",
        "content": "Studying the present perfect",
    }]))
    save = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "save_memory", save)

    listed = json.loads(await user_memory_tools._list_memories())
    assert listed["memories"][0]["id"] == "study"

    result = json.loads(await user_memory_tools._save_memory(
        "Moving on to the past perfect", "LEARNING", "English progress"))
    assert result["saved"] is False
    assert result["needs_review"] is True
    assert result["matches"][0]["id"] == "study"
    save.assert_not_awaited()

    missing_topic = json.loads(await user_memory_tools._save_memory(
        "Moving on to the past perfect", "LEARNING"))
    assert missing_topic["saved"] is False
    assert missing_topic["needs_category"] is True
    save.assert_not_awaited()
    user_memory_tools.memory_write_stage.set(False)


@pytest.mark.asyncio
async def test_memory_tools_update_and_delete_exact_id(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "is_memory_enabled_for_turn", AsyncMock(return_value=True))
    save = AsyncMock(return_value={"id": "one", "content": "Updated fact"})
    delete = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "save_memory", save)
    monkeypatch.setattr(user_memory_tools, "delete_memory", delete)
    monkeypatch.setattr(user_memory_tools, "list_memories", AsyncMock(return_value=[]))
    await user_memory_tools._list_memories()

    updated = json.loads(await user_memory_tools._update_memory(
        "one", "Updated fact", "PREFERENCE", "Topic"))
    assert updated["memory"]["content"] == "Updated fact"
    save.assert_awaited_once_with("Updated fact", "PREFERENCE", "Topic", memory_id="one")

    deleted = json.loads(await user_memory_tools._delete_memory("one"))
    assert deleted == {"ok": True, "deleted_id": "one"}
    delete.assert_awaited_once_with("one")
    user_memory_tools.memory_write_stage.set(False)
