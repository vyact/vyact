"""
services/llm/prepare.py — 비-Ollama provider 공통 준비 로직

api_key 로딩, 히스토리 구성, system/user 메시지 조합을 한 곳에서 처리한다.
query_llm / chat_stream_with_tools가 공유한다.
"""
from prompts import build_system_message, build_user_prompt
from .config import logger


async def prepare_request(
        question, context_docs, system_prompt, attachments,
        conversation_history, format_instruction_override, inject_user_profile,
        provider_type, model="", conversation_summary: str = "", include_skills: bool = True,
        isolated_system_prompt: bool = False,
):
    """(api_key, system_message, user_prompt, history_messages, valid_slice) 반환.

    provider_type: API 호출 방식(인증/스트리밍) 결정용.
    model: 첨부파일 프롬프트 포맷(xml/markdown) 결정용 — provider_type과 별개 축이다.
           (예: ollama라도 내부 모델이 gemma/qwen/llama 등으로 바뀔 수 있으므로 모델명 기준으로 분기)
    """
    api_key = None
    if provider_type != "ollama":
        try:
            from routers.deps import load_config_async
            cfg = await load_config_async()
            api_key = cfg.get(f"{provider_type}_config", {}).get("api_key") or cfg.get("api_key")
        except Exception:
            pass

    from .helpers import select_history_by_budget
    valid_slice = select_history_by_budget(conversation_history)
    history_messages = []
    for m in valid_slice:
        if m["role"] == "tool":
            history_messages.append({"role": "tool", "name": m.get("name", ""), "content": m["content"]})
        elif m["role"] == "assistant" and m.get("tool_calls"):
            history_messages.append({"role": "assistant", "content": m.get("content", ""), "tool_calls": m["tool_calls"]})
        else:
            history_messages.append({"role": m["role"], "content": m["content"]})

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
    # 사용자 UI 언어 로드
    user_language = ""
    try:
        from routers.deps import load_ui_language_async
        user_language = await load_ui_language_async() or ""
    except Exception:
        pass
    system_message = build_system_message(
        system_prompt, format_instruction_override, user_profile, skill_context, conversation_summary,
        user_language=user_language, isolated=isolated_system_prompt,
    )
    user_prompt = build_user_prompt(question, context_docs, attachments, model)
    return api_key, system_message, user_prompt, history_messages, valid_slice
