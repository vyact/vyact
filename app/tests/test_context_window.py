from config.models import LLM_INITIAL_NUM_CTX
from services.llm.context_window import select_context_allocation


def _messages(token_count: int) -> list[dict]:
    return [{"role": "user", "content": "x" * (token_count * 2)}]


def test_initial_context_is_32k_and_output_is_limited_to_half():
    context_window, output_limit = select_context_allocation(
        _messages(1_000), 131_072, 2, 32_768,
    )

    assert LLM_INITIAL_NUM_CTX == 32_768
    assert context_window == 32_768
    assert output_limit == 16_384


def test_context_doubles_when_input_and_output_do_not_fit():
    context_window, output_limit = select_context_allocation(
        _messages(20_000), 131_072, 2, 32_768,
    )

    assert context_window == 65_536
    assert output_limit == 32_768


def test_output_uses_only_remaining_space_at_context_cap():
    context_window, output_limit = select_context_allocation(
        _messages(120_000), 131_072, 2, 32_768,
    )

    assert context_window == 131_072
    assert output_limit == 11_072
