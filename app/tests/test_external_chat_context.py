import pytest

from routers import chat


@pytest.mark.asyncio
async def test_external_search_zero_results_is_not_a_failure(monkeypatch) -> None:
    async def empty_search(_question: str) -> list[dict]:
        return []

    async def no_selected_documents(_selections: list[dict]) -> list[dict]:
        return []

    async def settings() -> dict:
        return {}

    monkeypatch.setattr(chat, "search_gov24_candidates", empty_search)
    monkeypatch.setattr(chat, "load_selected_external_documents", no_selected_documents)
    monkeypatch.setattr(chat, "load_external_data_connections", settings)

    documents, instruction, _, status = await chat._get_selected_external_context(
        "관련 지원을 찾아줘", [chat.GOV24_SOURCE_ID], [],
    )

    assert documents == []
    assert status["no_results"] is True
    assert status["all_failed"] is False
    assert "returned no matching records" in instruction


@pytest.mark.asyncio
async def test_all_selected_service_searches_failing_is_terminal(monkeypatch) -> None:
    async def failed_search(_question: str) -> list[dict]:
        raise RuntimeError("elasticsearch unavailable")

    async def no_selected_documents(_selections: list[dict]) -> list[dict]:
        return []

    async def settings() -> dict:
        return {}

    monkeypatch.setattr(chat, "search_gov24_candidates", failed_search)
    monkeypatch.setattr(chat, "load_selected_external_documents", no_selected_documents)
    monkeypatch.setattr(chat, "load_external_data_connections", settings)

    documents, _, _, status = await chat._get_selected_external_context(
        "관련 지원을 찾아줘", [chat.GOV24_SOURCE_ID], [],
    )

    assert documents == []
    assert status["all_failed"] is True
    assert status["no_results"] is False


@pytest.mark.asyncio
async def test_partial_failure_keeps_successful_external_results(monkeypatch) -> None:
    async def failed_search(_question: str) -> list[dict]:
        raise RuntimeError("one index unavailable")

    async def successful_search(_question: str) -> list[dict]:
        return [{"id": "biz-1", "external_resource_id": chat.BIZ_SUPPORT_SOURCE_ID, "content": "result"}]

    async def no_selected_documents(_selections: list[dict]) -> list[dict]:
        return []

    async def settings() -> dict:
        return {}

    monkeypatch.setattr(chat, "search_gov24_candidates", failed_search)
    monkeypatch.setattr(chat, "search_biz_support_candidates", successful_search)
    monkeypatch.setattr(chat, "load_selected_external_documents", no_selected_documents)
    monkeypatch.setattr(chat, "load_external_data_connections", settings)

    documents, instruction, _, status = await chat._get_selected_external_context(
        "지원사업", [chat.GOV24_SOURCE_ID, chat.BIZ_SUPPORT_SOURCE_ID], [],
    )

    assert [document["id"] for document in documents] == ["biz-1"]
    assert status["all_failed"] is False
    assert status["failed_sources"] == ["Government24"]
    assert "Government24" in instruction
