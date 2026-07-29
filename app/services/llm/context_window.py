"""Context-window selection for Ollama chat requests."""
from __future__ import annotations

import math

from config.models import LLM_INITIAL_NUM_CTX, LLM_MAX_NUM_CTX

# Output is intentionally reserved separately from the input estimate.  This
# keeps ordinary chat at 32K while leaving room for a useful answer.
DEFAULT_OUTPUT_RESERVE_TOKENS = 4096


def clamp_context_limit(value: int | float | None) -> int:
    """Return a supported context upper bound, never below the 32K floor."""
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
    """Choose 32K, then double until the estimated request fits the configured cap."""
    limit = clamp_context_limit(max_context)
    output_reserve = min(max(int(num_predict or 0), 0), DEFAULT_OUTPUT_RESERVE_TOKENS)
    required = estimate_message_tokens(messages, chars_per_token) + output_reserve
    selected = LLM_INITIAL_NUM_CTX
    while selected < required and selected < limit:
        selected *= 2
    return min(selected, limit)
