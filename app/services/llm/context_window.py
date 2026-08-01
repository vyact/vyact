"""Context-window selection for Ollama chat requests."""
from __future__ import annotations

import math

from config.models import LLM_INITIAL_NUM_CTX, LLM_MAX_NUM_CTX

def clamp_context_limit(value: int | float | None) -> int:
    """Return a supported context upper bound, never below the initial floor."""
    try:
        requested = int(value or LLM_MAX_NUM_CTX)
    except (TypeError, ValueError):
        requested = LLM_MAX_NUM_CTX
    return max(LLM_INITIAL_NUM_CTX, min(requested, LLM_MAX_NUM_CTX))


def estimate_message_tokens(messages: list[dict], chars_per_token: float) -> int:
    """Conservatively estimate text tokens without depending on model-specific tokenizers."""
    ratio = max(float(chars_per_token or 2), 0.1)
    characters = sum(len(str(message.get("content", ""))) for message in messages)
    return math.ceil(characters / ratio)


def select_context_window(messages: list[dict], max_context: int | float | None,
                          chars_per_token: float, num_predict: int | float | None) -> int:
    """Choose 32K, then double until input and the output allowance fit."""
    return select_context_allocation(
        messages, max_context, chars_per_token, num_predict,
    )[0]


def select_context_allocation(messages: list[dict], max_context: int | float | None,
                              chars_per_token: float,
                              num_predict: int | float | None) -> tuple[int, int]:
    """Return a context window and an output cap of at most half that window."""
    limit = clamp_context_limit(max_context)
    input_tokens = estimate_message_tokens(messages, chars_per_token)
    configured_output = max(int(num_predict or 0), 0)
    selected = LLM_INITIAL_NUM_CTX
    while selected < limit:
        output_limit = min(configured_output, selected // 2)
        if input_tokens + output_limit <= selected:
            break
        selected *= 2
    selected = min(selected, limit)
    available_output = max(selected - input_tokens, 0)
    output_limit = min(configured_output, selected // 2, available_output)
    return selected, output_limit
