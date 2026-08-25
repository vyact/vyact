from unittest.mock import AsyncMock, patch

import pytest

from services.llm.helpers import select_history_by_budget_with_status
from services.llm.prepare import prepare_request


def test_complete_history_does_not_report_truncation():
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "current question"},
    ]

    selected, was_truncated = select_history_by_budget_with_status(history, budget=100)

    assert selected == history[:-1]
    assert was_truncated is False


def test_history_reports_when_older_messages_are_dropped():
    history = [
        {"role": "user", "content": "old question" * 20},
        {"role": "assistant", "content": "old answer" * 20},
        {"role": "user", "content": "recent question"},
        {"role": "assistant", "content": "recent answer"},
        {"role": "user", "content": "current question"},
    ]

    selected, was_truncated = select_history_by_budget_with_status(history, budget=10)

    assert selected == history[2:4]
    assert was_truncated is True


@pytest.mark.asyncio
async def test_rolling_summary_is_omitted_while_complete_history_is_present():
    history = [
        {"role": "user", "content": "hello"},
        {"role": "assistant", "content": "hi"},
        {"role": "user", "content": "current question"},
    ]
    with (
        patch("services.llm.config.get_provider_config", AsyncMock(return_value={})),
        patch("routers.deps.load_ui_language_async", AsyncMock(return_value="ko")),
    ):
        _, system_message, _, _, _ = await prepare_request(
            "current question", [], "stable system prompt", [], history, None,
            False, "openai", conversation_summary="ROLLING SUMMARY", include_skills=False,
        )

    assert "ROLLING SUMMARY" not in system_message


@pytest.mark.asyncio
async def test_rolling_summary_is_kept_when_older_history_was_dropped():
    history = [
        {"role": "user", "content": "old question" * 20},
        {"role": "assistant", "content": "old answer" * 20},
        {"role": "user", "content": "recent question"},
        {"role": "assistant", "content": "recent answer"},
        {"role": "user", "content": "current question"},
    ]
    runtime_settings = {"history_token_budget": 10, "history_chars_per_token": 2}
    with (
        patch("services.llm.config.get_provider_config", AsyncMock(return_value={})),
        patch("routers.deps.load_ui_language_async", AsyncMock(return_value="ko")),
        patch("services.llm.helpers.get_runtime_settings", return_value=runtime_settings),
    ):
        _, system_message, _, _, _ = await prepare_request(
            "current question", [], "stable system prompt", [], history, None,
            False, "openai", conversation_summary="ROLLING SUMMARY", include_skills=False,
        )

    assert "ROLLING SUMMARY" in system_message
