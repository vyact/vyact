from unittest.mock import AsyncMock, patch

import pytest

from services.llm.helpers import (
    select_history_by_budget_for_provider,
    select_history_by_budget_with_status,
)
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
async def test_local_history_uses_selected_model_tokenizer():
    history = [
        {"role": "user", "content": "old"},
        {"role": "assistant", "content": "recent"},
        {"role": "user", "content": "current"},
    ]
    counter = AsyncMock(side_effect=lambda messages, _config, _tools: len(messages) * 6)
    with patch("services.llm.token_counter.count_local_message_tokens", counter):
        selected, was_truncated = await select_history_by_budget_for_provider(
            history, {"is_local": True, "runtime": "mlx"}, budget=10,
        )

    assert selected == history[1:2]
    assert was_truncated is True
    assert counter.await_count > 0


@pytest.mark.asyncio
async def test_cloud_history_uses_internal_common_tokenizer():
    history = [
        {"role": "user", "content": "old"},
        {"role": "assistant", "content": "recent"},
        {"role": "user", "content": "current"},
    ]
    with patch(
        "services.llm.token_counter.count_cloud_message_tokens",
        side_effect=lambda messages: len(messages) * 6,
    ) as counter:
        selected, was_truncated = await select_history_by_budget_for_provider(
            history, {"type": "claude"}, budget=10,
        )

    assert selected == history[1:2]
    assert was_truncated is True
    assert counter.call_count > 0


@pytest.mark.asyncio
async def test_zero_history_budget_drops_all_prior_messages():
    history = [
        {"role": "user", "content": "old"},
        {"role": "assistant", "content": "recent"},
        {"role": "user", "content": "current"},
    ]

    selected, was_truncated = await select_history_by_budget_for_provider(
        history, {"is_local": False}, budget=0,
    )

    assert selected == []
    assert was_truncated is True


@pytest.mark.asyncio
async def test_prepare_limits_history_to_remaining_context_space():
    history = [
        {"role": "user", "content": "old"},
        {"role": "assistant", "content": "recent"},
        {"role": "user", "content": "current"},
    ]
    runtime_settings = {
        "history_token_budget": 100,
        "llm_num_predict": 8,
        "llm_max_tokens": 8,
    }
    provider_config = {
        "is_local": True,
        "runtime": "gguf",
        "context_size": 520,
    }
    with (
        patch("services.llm.config.get_provider_config", AsyncMock(return_value=provider_config)),
        patch("routers.deps.load_ui_language_async", AsyncMock(return_value="ko")),
        patch("services.llm.prepare.get_runtime_settings", return_value=runtime_settings),
        patch("services.llm.prepare.count_local_message_tokens", AsyncMock(return_value=10)),
    ):
        _, _, _, history_messages, valid_slice = await prepare_request(
            "current", [], "system", [], history, None,
            False, "openai", include_skills=False,
        )

    assert history_messages == []
    assert valid_slice == []


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
    runtime_settings = {"history_token_budget": 10}
    with (
        patch("services.llm.config.get_provider_config", AsyncMock(return_value={})),
        patch("routers.deps.load_ui_language_async", AsyncMock(return_value="ko")),
        patch("services.llm.prepare.get_runtime_settings", return_value={
            **runtime_settings, "llm_num_predict": 8, "llm_max_tokens": 8,
        }),
    ):
        _, system_message, _, _, _ = await prepare_request(
            "current question", [], "stable system prompt", [], history, None,
            False, "openai", conversation_summary="ROLLING SUMMARY", include_skills=False,
        )

    assert "ROLLING SUMMARY" in system_message
