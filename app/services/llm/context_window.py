"""Context-window selection for local chat requests."""
from __future__ import annotations

import math

from config.models import LLM_INITIAL_NUM_CTX, LLM_NUM_CTX
from services.runtime_settings import MINIMUM_CONTEXT_SIZE

LOCAL_CONTEXT_RESERVE_TOKENS = 512

def clamp_context_limit(value: int | float | None) -> int:
    """Return a supported context upper bound, never below the initial floor."""
    try:
        requested = int(value or LLM_NUM_CTX)
    except (TypeError, ValueError):
        requested = LLM_NUM_CTX
    return max(MINIMUM_CONTEXT_SIZE, requested)


def estimate_message_tokens(messages: list[dict], chars_per_token: float) -> int:
    """Conservatively estimate text tokens without depending on model-specific tokenizers."""
    ratio = max(float(chars_per_token or 2), 0.1)
    characters = sum(len(str(message.get("content", ""))) for message in messages)
    return math.ceil(characters / ratio)


def calculate_output_token_limit(messages: list[dict], context_size: int,
                                 chars_per_token: float, configured_output: int,
                                 input_tokens: int | None = None) -> int:
    """Honor the configured model output limit within the actual remaining context."""
    normalized_context_size = max(int(context_size), 1)
    input_tokens = input_tokens if input_tokens is not None else estimate_message_tokens(messages, chars_per_token)
    available_output = max(
        normalized_context_size - input_tokens - LOCAL_CONTEXT_RESERVE_TOKENS,
        1,
    )
    return min(
        max(int(configured_output), 1),
        available_output,
    )


def calculate_history_token_limit(
        configured_history: int, context_size: int, base_input_tokens: int,
        configured_output: int,
) -> int:
    """Fit optional conversation history around required request content."""
    normalized_context_size = max(int(context_size), 1)
    output_reserve = max(int(configured_output), 1)
    available_history = max(
        normalized_context_size - base_input_tokens - output_reserve - LOCAL_CONTEXT_RESERVE_TOKENS,
        0,
    )
    return min(max(int(configured_history), 0), available_history)


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
