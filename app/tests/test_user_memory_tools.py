import json
from unittest.mock import AsyncMock

import pytest

from services import user_memory_tools
from services.tool_approval import ApprovalContext, current_approval_context


@pytest.mark.asyncio
async def test_memory_tools_require_ordinary_chat_and_enabled_setting(monkeypatch):
    save = AsyncMock()
    monkeypatch.setattr(user_memory_tools, "save_memory", save)
    state = AsyncMock(return_value={"enabled": True})
    monkeypatch.setattr(user_memory_tools, "get_memory_state", state)

    token = current_approval_context.set(ApprovalContext(project_id="project"))
    try:
        assert not await user_memory_tools.user_memory_tools_available()
        result = json.loads(await user_memory_tools._save_memory("A preference", "PREFERENCE"))
        assert result["ok"] is False
        save.assert_not_awaited()
    finally:
        current_approval_context.reset(token)

    state.return_value = {"enabled": False}
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
async def test_memory_tool_saves_once_and_uses_conversation_id(monkeypatch):
    monkeypatch.setattr(user_memory_tools, "get_memory_state", AsyncMock(return_value={"enabled": True}))
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
    monkeypatch.setattr(user_memory_tools, "get_memory_state", AsyncMock(return_value={"enabled": True}))
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
    monkeypatch.setattr(user_memory_tools, "get_memory_state", AsyncMock(return_value={"enabled": True}))
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
