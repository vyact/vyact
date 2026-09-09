"""
services/llm/prepare.py — provider 공통 준비 로직

api_key 로딩, 히스토리 구성, system/user 메시지 조합을 한 곳에서 처리한다.
query_llm / chat_stream_with_tools가 공유한다.
"""
from prompts import build_system_message, build_user_prompt
from services.runtime_settings import get_runtime_settings, DEFAULT_RUNTIME_SETTINGS
from .config import logger
from .context_window import calculate_history_token_limit
from .helpers import select_history_by_budget_for_provider
from .token_counter import count_cloud_message_tokens
from . import token_counter
from .request_budget import fit_local_request, request_output_limit
from .providers import _get_unified_tools
from .tools import build_tool_directive
from .errors import ContextBudgetExceeded


async def prepare_request(
        question, context_docs, system_prompt, attachments,
        conversation_history, format_instruction_override, inject_user_profile,
        provider_type, model="", conversation_summary: str = "", include_skills: bool = True,
        isolated_system_prompt: bool = False,
        include_response_language: bool = True,
        reasoning: bool | str = False,
        use_tools: bool = False,
):
    """(api_key, system_message, user_prompt, history_messages, valid_slice) 반환.

    provider_type: API 호출 방식(인증/스트리밍) 결정용.
    model: 첨부파일 프롬프트 포맷(xml/markdown) 결정용 — provider_type과 별개 축이다.
           내부 모델이 gemma/qwen/llama 등으로 바뀔 수 있으므로 모델명 기준으로 분기한다.
    """
    request_output_limit.set(None)
    api_key = None
    provider_config = {}
    try:
        from .config import get_provider_config
        provider_config = await get_provider_config()
        api_key = provider_config.get("api_key")
    except Exception:
        pass

    user_profile = ""
    if inject_user_profile:
        try:
            from services.user_profile import get_profile_text
            user_profile = await get_profile_text()
        except Exception as e:
            logger.warning("user_profile 조회 실패 (무시): %s", e)
    skill_context = ""
    if include_skills:
        try:
            from routers.skills import match_skills
            matched = await match_skills(question)
            if matched:
                skill_context = "\n\n".join(
                    f"[{s['name']}]\n{s['instructions']}" for s in matched
                )
        except Exception as e:
            logger.debug("스킬 매칭 실패 (무시): %s", e)
    user_language = ""
    try:
        from routers.deps import load_ui_language_async
        user_language = await load_ui_language_async() or ""
    except Exception:
        pass
    user_prompt = build_user_prompt(question, context_docs, attachments, model)
    runtime_settings = get_runtime_settings()
    configured_history = provider_config.get(
        "history_token_budget", runtime_settings["history_token_budget"],
    )
    context_size = int(provider_config.get("context_size") or 0)
    configured_output = (
        runtime_settings["llm_num_predict"]
        if provider_config.get("is_local")
        else provider_config.get("max_output_tokens") or runtime_settings["llm_max_tokens"] or DEFAULT_RUNTIME_SETTINGS["llm_max_tokens"]
    )

    unified_tools, tool_names = await _get_unified_tools(use_tools) if provider_config.get("is_local") else ([], [])
    tool_directive = await build_tool_directive(tool_names) if tool_names else ""

    def request_system_message(summary: str) -> str:
        return build_system_message(
            system_prompt, format_instruction_override, user_profile, skill_context, summary,
            user_language=user_language, isolated=isolated_system_prompt,
            include_response_language=include_response_language,
            reasoning=reasoning,
        )
    async def select_history(summary: str) -> tuple[list, bool, str]:
        nonlocal user_prompt
        system_message_value = request_system_message(summary)
        if provider_config.get("is_local"):
            history_cap = configured_history
            if summary and history_cap is not None:
                base_tokens = await token_counter.count_local_message_tokens(
                    [{"role": "system", "content": request_system_message("")}], provider_config, None,
                )
                summary_tokens = await token_counter.count_local_message_tokens(
                    [{"role": "system", "content": system_message_value}], provider_config, None,
                )
                summary_cost = max(0, summary_tokens - base_tokens)
                if summary_cost > history_cap:
                    return await select_history("")
                history_cap -= summary_cost
            user_prompt, selected, was_truncated = await fit_local_request(
                question, context_docs, attachments, model, system_message_value,
                conversation_history, provider_config, configured_output, history_cap,
                unified_tools, tool_directive,
            )
            return selected, was_truncated, system_message_value
        history_budget = configured_history
        if context_size:
            required_messages = [
                {"role": "system", "content": system_message_value},
                {"role": "user", "content": user_prompt},
            ]
            base_input_tokens = count_cloud_message_tokens(required_messages)
            history_budget = calculate_history_token_limit(
                configured_history, context_size, base_input_tokens, configured_output,
            )
        selected, was_truncated = await select_history_by_budget_for_provider(
            conversation_history, provider_config, budget=history_budget,
        )
        return selected, was_truncated, system_message_value

    valid_slice, history_was_truncated, system_message = await select_history("")
    # The rolling summary is only needed after older turns were dropped. Since
    # it also consumes context, recalculate the safe history allowance with the
    # summary included instead of assuming the first selection still fits.
    if history_was_truncated and conversation_summary and configured_history != 0:
        try:
            valid_slice, history_was_truncated, system_message = await select_history(conversation_summary)
        except ContextBudgetExceeded:
            # A rolling summary is optional, unlike the current question and system instructions.
            valid_slice, history_was_truncated, system_message = await select_history("")

    history_messages = []
    for m in valid_slice:
        if m["role"] == "tool":
            history_messages.append({"role": "tool", "name": m.get("name", ""), "content": m["content"]})
        elif m["role"] == "assistant" and m.get("tool_calls"):
            history_messages.append({"role": "assistant", "content": m.get("content", ""), "tool_calls": m["tool_calls"]})
        else:
            history_messages.append({"role": m["role"], "content": m["content"]})
    return api_key, system_message, user_prompt, history_messages, valid_slice
