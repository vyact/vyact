"""Behavioral coverage for shared local context allocation."""
import pytest

from services.llm import request_budget as budget
from services.llm import token_counter
from services.llm.helpers import select_history_by_budget_for_provider
from services.content_budget import allocate_content_limits


@pytest.mark.parametrize("output,history,expected", [
    (None, None, (1228, 1383, 461)),
    (1536, 1536, (1536, 1152, 384)),
    (None, 0, (1228, 1844, 0)),
    (1536, 100, (1536, 1436, 100)),
    (10000, None, (3072, 0, 0)),
])
def test_auto_and_manual_caps_share_one_context(output, history, expected):
    result = budget.allocate_request_budget(4096, 512, output, history, 300000, 30000)
    assert result == expected
    assert sum(result) + 512 + 512 == 4096
    limits = allocate_content_limits([30000] * 10, result[1])
    assert sum(limits) == result[1]
    assert max(limits) - min(limits) <= 1


def test_unused_document_space_goes_to_history_without_exceeding_its_cap():
    assert budget.allocate_request_budget(4096, 512, 1536, 1000, 20, 30000) == (1536, 20, 1000)
    assert budget.allocate_request_budget(4096, 512, 1536, None, 20, 30000) == (1536, 20, 1516)


def test_absent_history_gives_all_remaining_space_to_documents():
    assert budget.allocate_request_budget(4096, 512, 1536, 1536, 300000, 0) == (1536, 1536, 0)


@pytest.fixture
def character_tokens(monkeypatch):
    async def count(messages, config, tools):
        return sum(len(message.get("content", "")) + 4 for message in messages) + (len(str(tools)) if tools else 0)

    async def tokenize(text, config):
        return list(text), "characters"

    async def decode(tokens, tokenizer, config):
        return "".join(tokens)

    monkeypatch.setattr(budget, "count_local_message_tokens", count)
    monkeypatch.setattr(token_counter, "count_local_message_tokens", count)
    monkeypatch.setattr(budget, "tokenize_text_for_provider", tokenize)
    monkeypatch.setattr(budget, "decode_provider_tokens", decode)
    return count


@pytest.mark.asyncio
@pytest.mark.parametrize("output,history_cap", [(None, None), (1536, 1536), (None, 0), (1536, None)])
async def test_ten_file_final_prompt_fits_without_mutating_originals(character_tokens, output, history_cap):
    documents = [{"title": str(i), "source": "file", "content": chr(0x410 + i) * 30000} for i in range(10)]
    history = [{"role": "assistant", "content": "older" * 1000}, {"role": "assistant", "content": "recent" * 10}]
    config = {"is_local": True, "context_size": 4096}
    prompt, selected, truncated = await budget.fit_local_request(
        "question", documents, [], "gemma", "system", history, config, output, history_cap,
    )
    counts = [prompt.count(chr(0x410 + i)) for i in range(10)]
    assert min(counts) > 0
    assert max(counts) - min(counts) <= 1
    assert all(len(doc["content"]) == 30000 for doc in documents)
    actual = await character_tokens([{"content": "system"}, *selected, {"content": prompt}], config, None)
    assert actual + budget.request_output_limit.get() + 512 <= 4096
    assert truncated
    assert selected == ([] if history_cap == 0 else history[1:])


@pytest.mark.asyncio
async def test_short_file_share_is_reallocated(character_tokens):
    docs = [{"title": "short", "source": "file", "content": "Ж" * 10},
            {"title": "long", "source": "file", "content": "Ф" * 30000}]
    prompt, selected, _ = await budget.fit_local_request("question", docs, [], "gemma", "system", [],
                                                        {"is_local": True, "context_size": 4096}, 1536, None)
    assert prompt.count("Ж") == 10
    assert prompt.count("Ф") > 1000
    assert selected == []


@pytest.mark.asyncio
async def test_a_single_oversized_history_message_is_excluded(character_tokens):
    assert await select_history_by_budget_for_provider(
        [{"role": "assistant", "content": "x" * 100}], {"is_local": True}, budget=10,
    ) == ([], True)


@pytest.mark.asyncio
async def test_final_input_includes_tool_schema_and_directive(character_tokens):
    config = {"is_local": True, "context_size": 4096}
    tools = [{"function": {"description": "tool" * 100}}]
    prompt, selected, _ = await budget.fit_local_request("question", [], [], "gemma", "system", [], config,
                                                        None, None, tools, "directive" * 10)
    actual = await character_tokens([{"content": "system" + "directive" * 10}, {"content": prompt}], config, tools)
    assert budget.request_output_limit.get() == (4096 - 512 - actual) * 2 // 5


@pytest.mark.asyncio
async def test_required_input_overflow_is_rejected(character_tokens):
    with pytest.raises(ValueError):
        await budget.fit_local_request("q" * 4000, [], [], "gemma", "system", [],
                                       {"is_local": True, "context_size": 4096}, None, None)


@pytest.mark.asyncio
async def test_post_tool_material_is_rebudgeted_with_existing_messages(character_tokens):
    config = {"is_local": True, "context_size": 4096}
    required = [{"role": "tool", "content": "tool result" * 80}]
    docs = [{"source": "file", "title": "large", "content": "Ж" * 30000}]
    prompt, _, _ = await budget.fit_local_request("question", docs, [], "gemma", "system", [], config,
                                                 1536, 0, required_messages=required)
    actual = await character_tokens([{"content": "system"}, *required, {"content": prompt}], config, None)
    assert actual + budget.request_output_limit.get() + 512 <= 4096
    assert 0 < prompt.count("Ж") < 30000


@pytest.mark.parametrize("output", [None, 1536])
def test_model_output_ceiling_applies_to_auto_and_manual_caps(output):
    assert budget.allocate_request_budget(4096, 512, output, None, 300000, 30000,
                                           model_output_limit=256) == (256, 2112, 704)
