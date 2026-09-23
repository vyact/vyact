import pytest
from unittest.mock import AsyncMock

from services import user_memory


def test_conversation_analysis_uses_only_user_statements():
    conversation = {"messages": [
        {"role": "user", "content": "I am studying the past perfect."},
        {"role": "assistant", "content": "You have finished the past perfect."},
        {"role": "user", "content": "/remember"},
    ]}
    assert user_memory._conversation_user_chunks(conversation) == ["I am studying the past perfect."]


def test_analysis_requires_structured_operations():
    assert user_memory._parse_operations('{"operations":[]}') == []
    with pytest.raises(ValueError):
        user_memory._parse_operations("No changes")


def test_long_conversation_is_processed_without_dropping_earlier_user_text():
    first = "first fact " * 1500
    last = "last fact"
    chunks = user_memory._conversation_user_chunks({"messages": [
        {"role": "user", "content": first},
        {"role": "user", "content": last},
    ]})
    assert len(chunks) > 1
    assert "first fact" in chunks[0]
    assert last in chunks[-1]


@pytest.mark.asyncio
async def test_merge_updates_existing_id_and_ignores_unknown_delete(monkeypatch):
    saved = []
    deleted = []

    async def fake_save(content, memory_type, category, **kwargs):
        saved.append((content, memory_type, category, kwargs))
        return {"id": kwargs.get("memory_id") or "new", "content": content}

    async def fake_delete(memory_id):
        deleted.append(memory_id)

    monkeypatch.setattr(user_memory, "save_memory", fake_save)
    monkeypatch.setattr(user_memory, "delete_memory", fake_delete)
    existing = [{"id": "study", "content": "Studying present perfect."}]
    operations = [
        {"action": "delete", "id": "unknown"},
        {"action": "add", "content": "Studying present perfect.", "memory_type": "LEARNING"},
        {"action": "update", "id": "study", "content": "Studying past perfect.",
         "memory_type": "LEARNING", "category": "English"},
    ]

    assert await user_memory._apply_operations(operations, existing, "conv") == 1
    assert deleted == []
    assert saved == [("Studying past perfect.", "LEARNING", "English",
                      {"memory_id": "study", "source_conv_id": "conv"})]


@pytest.mark.asyncio
async def test_retrieval_excludes_weak_matches_and_respects_off_switch(monkeypatch):
    class FakeEs:
        count = AsyncMock(return_value={"count": 2})
        search = AsyncMock(return_value={"hits": {"hits": [
            {"_id": "study", "_score": 0.81, "_source": {
                "memory_type": "LEARNING", "category": "English", "content": "Studying past perfect."}},
            {"_id": "stocks", "_score": 0.61, "_source": {
                "memory_type": "PROJECT", "category": "Stocks", "content": "Building a trading app."}},
        ]}})
        close = AsyncMock()

    fake_es = FakeEs()
    monkeypatch.setattr(user_memory, "get_es", lambda: fake_es)
    monkeypatch.setattr(user_memory, "get_embedding", AsyncMock(return_value=[0.1] * 1024))
    monkeypatch.setattr(user_memory, "get_memory_state", AsyncMock(return_value={"enabled": True}))
    assert [item["id"] for item in await user_memory.retrieve_memories("Continue English study")] == ["study"]

    monkeypatch.setattr(user_memory, "get_memory_state", AsyncMock(return_value={"enabled": False}))
    assert await user_memory.retrieve_memories("Continue English study") == []
    assert fake_es.count.await_count == 1
