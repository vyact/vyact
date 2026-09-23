import json

import pytest
from unittest.mock import AsyncMock
import httpx
from fastapi import FastAPI

from routers import user_memory as user_memory_router
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
    assert user_memory._parse_operations("[]") == []
    assert user_memory._parse_operations('[{"action":"add","content":"I study English"}]') == [
        {"action": "add", "content": "I study English"}]
    with pytest.raises(ValueError):
        user_memory._parse_operations("No changes")
    with pytest.raises(ValueError):
        user_memory._parse_operations('["not an operation"]')


def test_memory_fingerprint_ignores_spacing_variants():
    assert user_memory._memory_fingerprint("Vyact 라는 앱을 개발 중") == \
           user_memory._memory_fingerprint("Vyact라는 앱을 개발 중")


def test_memory_update_notice_requires_actual_success():
    from routers.chat import _saved_memory_from_tool_result

    saved = {"ok": True, "memory": {"id": "study", "memory_type": "LEARNING",
                                   "category": "English", "content": "Next: past perfect"}}
    assert _saved_memory_from_tool_result("user_memory_save", json.dumps(saved)) == saved["memory"]
    assert _saved_memory_from_tool_result("user_memory_save", json.dumps({**saved, "unchanged": True})) is None
    assert _saved_memory_from_tool_result("user_memory_save", '{"ok":false,"error":"disabled"}') is None
    assert _saved_memory_from_tool_result("user_memory_list", json.dumps(saved)) is None


@pytest.mark.asyncio
async def test_disabled_memory_is_not_added_to_chat_context(monkeypatch):
    monkeypatch.setattr(user_memory, "get_memory_state", AsyncMock(return_value={"enabled": False}))
    embedding = AsyncMock()
    monkeypatch.setattr(user_memory, "get_embedding", embedding)

    assert await user_memory.memory_context("What should I continue?") == ""
    embedding.assert_not_awaited()


@pytest.mark.asyncio
async def test_delete_all_resets_past_chat_analysis_cursor(monkeypatch):
    class FakeEs:
        delete_by_query = AsyncMock()
        update = AsyncMock()
        close = AsyncMock()

    fake_es = FakeEs()
    monkeypatch.setattr(user_memory, "get_es", lambda: fake_es)
    await user_memory.delete_all_memories()
    assert fake_es.update.await_args.kwargs["doc"] == {
        "record_type": "state", "last_processed_at": None,
        "last_processed_sort_time": None, "last_processed_conv_id": None,
    }


@pytest.mark.asyncio
async def test_analysis_retries_invalid_model_response(monkeypatch):
    from services.llm import core

    responses = iter(["null", '[{"action":"add","memory_type":"LEARNING",'
                             '"category":"English","content":"Studying English"}]'])
    calls = []

    async def fake_query(prompt, docs, **kwargs):
        calls.append(kwargs["call_reason"])
        return next(responses)

    monkeypatch.setattr(core, "query_llm", fake_query)
    operations = await user_memory._analyze_user_text("I am studying English", [])
    assert operations[0]["content"] == "Studying English"
    assert calls == ["user_memory_analysis", "user_memory_analysis_retry"]


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
async def test_changed_memory_does_not_block_readding_previous_fact(monkeypatch):
    saved = []

    async def fake_save(content, memory_type, category, **kwargs):
        saved.append(content)
        return {"id": kwargs.get("memory_id") or "new", "content": content}

    monkeypatch.setattr(user_memory, "save_memory", fake_save)
    operations = [
        {"action": "update", "id": "one", "content": "New fact", "memory_type": "PROFILE"},
        {"action": "add", "content": "Old fact", "memory_type": "PROFILE"},
    ]
    assert await user_memory._apply_operations(operations, [{"id": "one", "content": "Old fact"}], "chat") == 2
    assert saved == ["New fact", "Old fact"]


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


@pytest.mark.asyncio
async def test_refresh_reports_each_conversation_progress(monkeypatch):
    class FakeEs:
        count = AsyncMock(return_value={"count": 2})
        search = AsyncMock(return_value={"hits": {"hits": [
            {"_source": {"conv_id": "one", "title": "English", "updated_at": "2026-09-20T10:00:00Z",
                         "messages": [{"role": "user", "content": "Studying English"}]}, "sort": [1000, "one"]},
            {"_source": {"conv_id": "two", "title": "Work", "updated_at": "2026-09-21T10:00:00Z",
                         "messages": [{"role": "user", "content": "Building Vyact"}]}, "sort": [2000, "two"]},
        ]}})
        update = AsyncMock()
        close = AsyncMock()

    fake_es = FakeEs()
    monkeypatch.setattr(user_memory, "get_es", lambda: fake_es)
    monkeypatch.setattr(user_memory, "get_memory_state", AsyncMock(return_value={"enabled": True}))
    monkeypatch.setattr(user_memory, "_existing_for_analysis", AsyncMock(return_value=[]))
    monkeypatch.setattr(user_memory, "_analyze_user_text", AsyncMock(return_value=[]))
    monkeypatch.setattr(user_memory, "_apply_operations", AsyncMock(return_value=0))
    reports = []

    async def report(progress):
        reports.append(progress)

    result = await user_memory.refresh_memories(report)
    assert result == {"processed": 2, "changed": 0}
    assert reports == [
        {"processed": 0, "total": 2, "title": ""},
        {"processed": 0, "total": 2, "title": "English"},
        {"processed": 1, "total": 2, "title": ""},
        {"processed": 1, "total": 2, "title": "Work"},
        {"processed": 2, "total": 2, "title": ""},
    ]


@pytest.mark.asyncio
async def test_refresh_stream_exposes_progress_and_completion(monkeypatch):
    async def fake_refresh(report):
        await report({"processed": 0, "total": 1, "title": "English"})
        await report({"processed": 1, "total": 1, "title": ""})
        return {"processed": 1, "changed": 1}

    monkeypatch.setattr(user_memory_router, "refresh_memories", fake_refresh)
    app = FastAPI()
    app.include_router(user_memory_router.router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
        response = await client.post("/user-memories/refresh/stream")
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/event-stream")
    assert 'event: progress\ndata: {"processed": 0, "total": 1, "title": "English"}' in response.text
    assert 'event: done\ndata: {"processed": 1, "changed": 1}' in response.text
