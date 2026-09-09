"""Shared request budget for local output, document bodies and recent history."""
import asyncio
from contextvars import ContextVar

from prompts import build_user_prompt
from services.content_budget import allocate_content_limits
from .context_window import LOCAL_CONTEXT_RESERVE_TOKENS, reserve_output_tokens
from .errors import context_budget_error
from .helpers import select_history_by_budget_for_provider, history_for_openai
from .token_counter import (
    count_local_message_tokens, tokenize_text_for_provider, decode_provider_tokens,
    IMAGE_INPUT_TOKEN_RESERVE, OTHER_MEDIA_INPUT_TOKEN_RESERVE,
)

DOCUMENT_SHARE_NUMERATOR = 3
DOCUMENT_SHARE_DENOMINATOR = 4
request_output_limit: ContextVar[int | None] = ContextVar("request_output_limit", default=None)


def allocate_request_budget(context_size, required_tokens, configured_output,
                            configured_history, document_tokens, history_tokens, model_output_limit=None):
    available = max(0, context_size - LOCAL_CONTEXT_RESERVE_TOKENS - required_tokens)
    output = reserve_output_tokens(available, configured_output)
    if model_output_limit is not None:
        output = min(output, max(1, int(model_output_limit)))
    remaining = available - output
    history_demand = max(0, history_tokens)
    if configured_history is not None:
        history_demand = min(history_demand, max(0, configured_history))
    documents = min(document_tokens, remaining * DOCUMENT_SHARE_NUMERATOR // DOCUMENT_SHARE_DENOMINATOR)
    history = min(history_demand, remaining - documents)
    documents = min(document_tokens, remaining - history)
    history = min(history_demand, remaining - documents)
    return output, documents, history


async def fit_local_request(question, docs, attachments, model, system_message,
                            history, provider_config, configured_output, configured_history,
                            tools=None, tool_directive="", required_messages=()):
    """Count formatted inputs, divide document bodies fairly, then verify the full prompt."""
    context_size = int(provider_config.get("context_size") or 32768)
    docs = [dict(doc) for doc in docs or []]
    empty_docs = [{**doc, "content": ""} for doc in docs]
    count_system = system_message + tool_directive
    media_reserve = sum(
        IMAGE_INPUT_TOKEN_RESERVE if item.get("type") == "image" else OTHER_MEDIA_INPUT_TOKEN_RESERVE
        for item in attachments or [] if item.get("type") in {"image", "audio", "video"}
    )

    async def count_prompt(prompt, selected=()):
        return media_reserve + await count_local_message_tokens([
            {"role": "system", "content": count_system}, *required_messages, *history_for_openai(list(selected), list(selected)),
            {"role": "user", "content": prompt},
        ], provider_config, tools)

    required = await count_prompt(build_user_prompt(question, empty_docs, attachments, model))
    # Metadata is optional too: an empty document envelope must not crowd out the question.
    if required + LOCAL_CONTEXT_RESERVE_TOKENS >= context_size and docs:
        docs = []
        required = await count_prompt(build_user_prompt(question, [], attachments, model))
    if required + LOCAL_CONTEXT_RESERVE_TOKENS >= context_size:
        raise await context_budget_error()

    tokenized = await asyncio.gather(*(
        tokenize_text_for_provider(str(doc.get("content", "")), provider_config) for doc in docs
    ))
    sizes = [len(tokens) for tokens, _ in tokenized]
    all_history, _ = await select_history_by_budget_for_provider(history, provider_config, budget=context_size)
    history_size = await count_local_message_tokens(history_for_openai(all_history, all_history), provider_config, None) if all_history else 0
    output, document_budget, history_budget = allocate_request_budget(
        context_size, required, configured_output, configured_history, sum(sizes), history_size,
        provider_config.get("output_token_limit"),
    )
    selected, truncated = await select_history_by_budget_for_provider(history, provider_config, budget=history_budget)
    used_history = await count_local_message_tokens(history_for_openai(selected, selected), provider_config, None) if selected else 0
    document_budget += max(0, history_budget - used_history)

    async def render_documents(budget):
        limits = allocate_content_limits(sizes, budget)
        limited = []
        for doc, limit, (tokens, tokenizer) in zip(docs, limits, tokenized):
            if limit == 0:
                continue
            content = doc.get("content", "") if limit >= len(tokens) else await decode_provider_tokens(tokens[:limit], tokenizer, provider_config)
            limited.append({**doc, "content": content})
        return build_user_prompt(question, limited, attachments, model)

    prompt = await render_documents(document_budget)
    input_limit = context_size - LOCAL_CONTEXT_RESERVE_TOKENS - output
    # Token boundaries and chat templates are not perfectly additive. Check the assembled input.
    actual = await count_prompt(prompt, selected)
    while actual > input_limit and (document_budget > 0 or selected):
        excess = actual - input_limit
        if document_budget > 0:
            document_budget = max(0, document_budget - excess)
            prompt = await render_documents(document_budget)
        else:
            selected = selected[1:]
            truncated = True
        actual = await count_prompt(prompt, selected)
    if actual > input_limit:
        output = min(output, context_size - LOCAL_CONTEXT_RESERVE_TOKENS - actual)
    if output < 1:
        raise await context_budget_error()
    request_output_limit.set(output)
    return prompt, selected, truncated
