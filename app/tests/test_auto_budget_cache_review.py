"""Regression checks for auto budgets and the actual reusable request prefix."""
from itertools import product
from unittest.mock import AsyncMock

import pytest

from prompts import build_system_message
from routers import deps
from services.llm import config, helpers, prepare, request_budget, token_counter


@pytest.mark.asyncio
async def test_history_budget_counts_media_as_sent(monkeypatch):
    history = [
        {"role": "user", "content": "first", "attachments": [{"type": "image", "name": "one"}]},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "next", "attachments": [{"type": "image", "name": "two"}]},
        {"role": "assistant", "content": "recent"},
    ]
    monkeypatch.setattr(helpers, "load_image_data_urls", lambda attachments: [a["name"] for a in attachments])
    monkeypatch.setattr(helpers, "load_audio_content_blocks", lambda _: [])

    async def count(messages, config, tools):
        return sum(100 if isinstance(m.get("content"), list) else 5 for m in messages)

    monkeypatch.setattr(token_counter, "count_local_message_tokens", count)
    selected, truncated = await helpers.select_history_by_budget_for_provider(
        history, {"is_local": True}, budget=30,
    )
    assert selected == history[-1:]
    assert truncated


def test_history_images_keep_their_original_message_positions(monkeypatch):
    history = [
        {"role": "user", "content": "first", "attachments": [{"name": "one"}]},
        {"role": "assistant", "content": "answer"},
        {"role": "user", "content": "next", "attachments": [{"name": "two"}]},
        {"role": "assistant", "content": "recent"},
    ]
    monkeypatch.setattr(helpers, "load_image_data_urls", lambda attachments: [a["name"] for a in attachments])
    monkeypatch.setattr(helpers, "load_audio_content_blocks", lambda _: [])
    result = helpers.history_for_openai(history, history)
    assert result[0]["content"][1]["image_url"]["url"] == "one"
    assert result[2]["content"][1]["image_url"]["url"] == "two"


@pytest.fixture
def prepared_request(monkeypatch):
    async def count(messages, config, tools):
        return sum(len(str(m.get("content", ""))) + 4 for m in messages)

    monkeypatch.setattr(config, "get_provider_config", AsyncMock(return_value={
        "is_local": True, "context_size": 8192, "runtime": "gguf",
    }))
    monkeypatch.setattr(deps, "load_ui_language_async", AsyncMock(return_value="en"))
    monkeypatch.setattr(prepare, "get_runtime_settings", lambda: {
        "history_token_budget": None, "llm_num_predict": None, "llm_max_tokens": None,
    })
    monkeypatch.setattr(token_counter, "count_local_message_tokens", count)
    monkeypatch.setattr(request_budget, "count_local_message_tokens", count)

    async def request(question, history, summary=""):
        result = await prepare.prepare_request(
            question, [], "STATIC RULES", [], history, None, False, "openai",
            conversation_summary=summary, include_skills=False,
        )
        _, system, user, messages, valid = result
        return [{"role": "system", "content": system}, *helpers.history_for_openai(messages, valid),
                {"role": "user", "content": user}], request_budget.request_output_limit.get()
    return request


@pytest.mark.asyncio
async def test_auto_output_change_preserves_accumulated_prefix(prepared_request):
    first, first_output = await prepared_request("question one", [])
    history = [first[-1], {"role": "assistant", "content": "answer one"}]
    second, second_output = await prepared_request("question two " * 40, history, "UNNEEDED SUMMARY")
    assert second[:len(first)] == first
    assert second[len(first)] == history[-1]
    assert "UNNEEDED SUMMARY" not in second[0]["content"]
    assert second_output < first_output


@pytest.mark.asyncio
async def test_summary_only_changes_prefix_after_stable_system_rules(prepared_request):
    first, _ = await prepared_request("question", [])
    history = [{"role": "user", "content": "old" * 5000},
               {"role": "assistant", "content": "recent answer"}]
    second, _ = await prepared_request("question", history, "OLDER SUMMARY")
    assert "OLDER SUMMARY" in second[0]["content"]
    assert second[0]["content"].split("[Earlier conversation summary]")[0] == first[0]["content"].split("[Response language]")[0]
    assert second[-1]["role"] == "user"


@pytest.mark.asyncio
async def test_history_counter_receives_wire_tool_call_format(monkeypatch):
    history = [{"role": "assistant", "content": "", "tool_calls": [{"name": "search", "args": {"q": "term"}}]},
               {"role": "tool", "name": "search", "content": "result"}]
    counter = AsyncMock(return_value=10)
    monkeypatch.setattr(token_counter, "count_local_message_tokens", counter)
    selected, _ = await helpers.select_history_by_budget_for_provider(history, {"is_local": True}, 100)
    sent = counter.await_args.args[0]
    assert sent[0]["tool_calls"][0]["function"]["name"] == "search"
    assert sent[1]["tool_call_id"] == sent[0]["tool_calls"][0]["id"]
    assert selected == history


def test_system_prefix_orders_static_rules_before_changing_context():
    text = build_system_message("STATIC", None, "PROFILE", "SKILL", "SUMMARY", "en", reasoning=True)
    parts = ["STATIC", "[Response length]", "[Reasoning budget]", "Current date:",
             "[User profile]", "[Earlier conversation summary]", "[Skill instructions]", "[Response language]"]
    assert [text.index(part) for part in parts] == sorted(text.index(part) for part in parts)


def test_budget_invariants_across_contexts_and_mixed_caps():
    for context, required, output, history, document_size, history_size in product(
        [512, 4096, 8192, 32768], [0, 500, 3500], [None, 1, 1536, 99999],
        [None, 0, 100, 99999], [0, 10, 300000], [0, 10, 30000],
    ):
        allocations = request_budget.allocate_request_budget(context, required, output, history, document_size, history_size)
        generated, documents, records = allocations
        assert all(value >= 0 for value in allocations)
        assert sum(allocations) <= max(0, context - required - 512)
        assert documents <= document_size
        assert records <= history_size
        if output is not None:
            assert generated <= output
        if history is not None:
            assert records <= history
