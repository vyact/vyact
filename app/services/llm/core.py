"""
services/llm/core.py — 최상위 진입점

chat_stream_with_tools : MCP tool 처리 + 최종 답변 토큰 스트리밍
query_llm              : 논스트리밍 단발 응답
"""
import asyncio
import base64
import uuid
from datetime import datetime, timezone

import httpx

from prompts import build_user_prompt
from .config import (
    IMAGES_DIR, get_provider_config, log_llm_call, log_llm_interaction, logger,
)
from .helpers import (
    mime_type, history_for_gemini, history_for_claude,
)
from .errors import (
    http_err_msg,
    is_model_image_unsupported_error,
    openai_err,
    gemini_err,
    claude_err,
)
from .providers import openai_stream, gemini_stream, claude_stream
from .prepare import prepare_request
from services.runtime_settings import get_runtime_settings

_STREAMERS = {"openai": openai_stream, "gemini": gemini_stream, "claude": claude_stream}
_PROVIDER_LABEL = {"openai": "OpenAI", "gemini": "Gemini", "claude": "Claude"}


async def chat_stream_with_tools(
        question: str,
        context_docs: list[dict],
        system_prompt: str = "",
        attachments: list | None = None,
        conversation_history: list | None = None,
        timeout: float = 900.0,
        format_instruction_override: str | None = None,
        inject_user_profile: bool = True,
        conversation_summary: str = "",
        use_tools: bool = True,
        reasoning: bool = True,
        post_tool_docs=None,
        call_reason: str = "unspecified",
        include_skills: bool = True,
        isolated_system_prompt: bool = False,
        include_response_language: bool = True,
):
    """MCP tool 처리 + 최종 답변 토큰 스트리밍 (모든 provider 지원).

    dict 이벤트를 yield 한다:
      {"type": "tool",  "phase": "start"/"end", "name": ..., "args": ...}
      {"type": "token", "text": <조각>}
      {"type": "rag_fallback", "docs": [...]}  (local provider에서 post_tool_docs 지정 시)

    provider별로 tool 루프(function-calling) 후 최종 답변을 SSE로 스트리밍한다.
    use_tools=False 이면 tool 판정을 건너뛴다(선택 문서 기반 질의 등).

    post_tool_docs: async (tool_got_sources: bool, completed_tool_names: set[str]) -> list[dict]
        (local provider 전용, 선택)
        tool 판정 라운드가 끝나면 항상 한 번 호출된다. 인자로 "tool이 sources를
        가져왔는지"를 넘겨주므로, 호출부에서 다음처럼 알아서 판단하면 된다:
          - tool_got_sources=True  → 메모처럼 tool과 무관하게 항상 필요한 것만 조회
          - tool_got_sources=False → 메모 + ES(RAG) 뉴스를 병행 조회해서 보충
        (tool을 안 썼거나, 썼는데도 결과가 없을 때 모두 False로 들어온다.)
    """
    attachments = attachments or []
    conversation_history = conversation_history or []
    provider_config = await get_provider_config()
    provider_type = provider_config["type"]
    provider_label = provider_config.get("connection_name", provider_type)

    if provider_type in _STREAMERS:
        model = provider_config["model"]
        collected: list[str] = []
        tools_used: list[str] = []
        log_entry = {
            "request_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": provider_label, "model": model,
            "docs_count": len(context_docs),
            "streaming": True, "response": None, "error": None,
        }
        try:
            (api_key, sys_msg, usr_msg, history_messages, valid_slice) = await prepare_request(
                question, context_docs, system_prompt, attachments,
                conversation_history, format_instruction_override, inject_user_profile,
                provider_type, model, conversation_summary, include_skills, isolated_system_prompt,
                include_response_language,
            )
            log_entry["system_message"] = sys_msg
            log_entry["user_prompt"] = usr_msg

            streamer = _STREAMERS.get(provider_type)
            if streamer is None:
                yield {"type": "token", "text": f"지원하지 않는 Provider: {provider_type}"}
                return

            # tool 진행 이벤트를 큐로 받아 실시간으로 흘린다.
            _queue: "asyncio.Queue[dict]" = asyncio.Queue()

            async def _on_tool_event(ev: dict):
                if ev.get("phase") == "rag_fallback":
                    await _queue.put({"type": "rag_fallback", "docs": ev.get("docs") or []})
                    return
                if ev.get("phase") == "start" and ev.get("name"):
                    tools_used.append(ev["name"])
                await _queue.put({"type": "tool", **ev})

            usage: dict = {}  # streamer가 채워주는 토큰 사용량 (prompt_tokens/completion_tokens)

            # 실제 호출별 로그(tool 판정 라운드/최종 스트리밍)는 각 provider의
            # openai_stream/gemini_stream/claude_stream 내부에서 남긴다 (call_reason 전달).
            async with httpx.AsyncClient(timeout=timeout) as client:
                gen = streamer(client, model, api_key, sys_msg, usr_msg,
                               history_messages, valid_slice, attachments,
                               timeout, use_tools=use_tools, on_event=_on_tool_event, usage=usage,
                               call_reason=call_reason, reasoning=reasoning,
                               **({
                                   "post_tool_docs": post_tool_docs,
                                   "post_tool_prompt": lambda extra_docs: build_user_prompt(
                                       question, [*context_docs, *extra_docs], attachments, model,
                                   ),
                               } if provider_config.get("selection_type") == "vyact" else {}))

                # streamer는 async generator. tool 루프는 첫 토큰 전에 끝나고,
                # 그 사이 on_event가 큐에 tool 이벤트를 넣는다.
                # 큐와 토큰을 함께 흘리기 위해, 토큰 소비 태스크를 돌리며 큐를 먼저 비운다.
                async def _pump_tokens():
                    try:
                        async for piece in gen:
                            await _queue.put({"type": "token", "text": piece})
                    except Exception as error:
                        await _queue.put({"__error__": error})
                    finally:
                        await _queue.put({"__done__": True})

                pump = asyncio.create_task(_pump_tokens())
                try:
                    while True:
                        ev = await _queue.get()
                        if ev.get("__error__") is not None:
                            raise ev["__error__"]
                        if ev.get("__done__"):
                            break
                        if ev.get("type") == "token":
                            collected.append(ev["text"])
                        yield ev
                finally:
                    pump.cancel()
                    try:
                        await pump
                    except asyncio.CancelledError:
                        pass

            if usage.get("prompt_tokens") is not None or usage.get("completion_tokens") is not None:
                prompt_duration = usage.get("prompt_eval_duration")
                eval_duration = usage.get("eval_duration")
                stats = {
                    "prompt_eval_count": usage.get("prompt_tokens"),
                    "prompt_eval_duration": prompt_duration,
                    "eval_count": usage.get("completion_tokens"),
                    "eval_duration": eval_duration,
                    "llm_total_duration": usage.get("llm_total_duration"),
                    "total_duration": (
                        prompt_duration + eval_duration
                        if prompt_duration is not None and eval_duration is not None
                        else None
                    ),
                }
                log_entry["stats"] = stats
                yield {"type": "stats", **stats}
            if usage.get("finish_reason"):
                yield {"type": "finish", "reason": usage["finish_reason"]}
        except httpx.HTTPStatusError as e:
            if attachments and is_model_image_unsupported_error(e):
                log_entry["error"] = "model_image_unsupported"
                yield {"type": "error", "code": "model_image_unsupported", "model": model}
            else:
                msg = http_err_msg(e, _PROVIDER_LABEL.get(provider_type, provider_type))
                log_entry["error"] = msg
                yield {"type": "token", "text": f"\n\n❌ {msg}"}
        except Exception as e:
            logger.error("[chat_stream_with_tools] %s 스트리밍 실패: %s", provider_type, e)
            log_entry["error"] = f"{type(e).__name__}: {e}"
            yield {"type": "token", "text": f"\n\n❌ 스트리밍 중 오류가 발생했습니다: {type(e).__name__}"}
        finally:
            log_entry["response"] = "".join(collected)
            log_entry["tools_used"] = tools_used or None
            try:
                await log_llm_interaction(log_entry)
            except Exception as _le:
                logger.warning("[chat_stream_with_tools] 로그 저장 실패: %s", _le)
        return


async def collect_llm_stream(
        question: str,
        context_docs: list[dict],
        system_prompt: str = "",
        attachments: list | None = None,
        conversation_history: list | None = None,
        timeout: float = 900.0,
        format_instruction_override: str | None = None,
        inject_user_profile: bool = True,
        conversation_summary: str = "",
        use_tools: bool = True,
        reasoning: bool = True,
        call_reason: str = "unspecified",
        include_skills: bool = True,
        isolated_system_prompt: bool = False,
        include_response_language: bool = True,
) -> tuple[str, dict | None]:
    """chat_stream_with_tools를 내부적으로 소비하여 (answer, stats)를 반환.

    query_llm과 동일한 결과를 돌려주되, 내부적으로 스트리밍이므로
    asyncio 취소(CancelledError/GeneratorExit)에 즉시 반응한다.
    장시간 블로킹 없이 토큰 단위로 await 포인트가 생겨
    클라이언트 disconnect 시 빠르게 중단된다.
    """
    parts: list[str] = []
    stats: dict | None = None
    async for ev in chat_stream_with_tools(
            question, context_docs, system_prompt=system_prompt,
            attachments=attachments, conversation_history=conversation_history,
            timeout=timeout, format_instruction_override=format_instruction_override,
            inject_user_profile=inject_user_profile, conversation_summary=conversation_summary, use_tools=use_tools,
            reasoning=reasoning, call_reason=call_reason, include_skills=include_skills,
            isolated_system_prompt=isolated_system_prompt,
            include_response_language=include_response_language,
    ):
        if ev.get("type") == "token":
            parts.append(ev.get("text", ""))
        elif ev.get("type") == "stats":
            stats = {k: v for k, v in ev.items() if k != "type"}
    return "".join(parts).strip(), stats


async def query_llm(
        question: str,
        context_docs: list[dict],
        system_prompt: str = "",
        attachments: list | None = None,
        conversation_history: list | None = None,
        timeout: float = 900.0,
        format_instruction_override: str | None = None,
        inject_user_profile: bool = True,
        conversation_summary: str = "",
        use_tools: bool = True,
        top_k: int | None = None,
        top_p: float | None = None,
        num_predict: int | None = None,
        reasoning: bool = True,
        call_reason: str = "unspecified",
        stats_out: dict | None = None,
        include_skills: bool = True,
        structured_output_schema: dict | None = None,
        include_response_language: bool = True,
) -> str:
    """논스트리밍 단발 응답 (모든 provider).

    stats_out: 호출부가 빈 dict를 넘기면 provider 응답의 토큰수/처리시간 통계를 채워 넣는다.

    use_tools=False 이면 MCP tool 판정/루프를 건너뛴다. 번역처럼 tool이
    전혀 필요 없는 단발 호출에서 불필요한 tool 판정 왕복을 없애 속도를 높인다.

    reasoning=False 이면 지원하는 로컬 모델의 thinking(추론) 단계를 끈다.
    번역은 항상 reasoning=False 로 호출한다.

    structured_output_schema를 지정하면 지원하는 로컬 런타임에 JSON Schema를 전달한다.

    include_response_language=False이면 사용자 UI 언어 응답 규칙만 제외한다.
    기본값은 True이므로 기존 호출의 응답 언어 동작은 유지된다.
    """
    attachments = attachments or []
    conversation_history = conversation_history or []
    request_id = str(uuid.uuid4())
    log_entry = {
        "request_id": request_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": None, "model": None,
        "system_message": None, "user_prompt": None,
        "docs_count": len(context_docs),
        "origin_response": None, "response": None, "error": None,
    }

    provider_config = await get_provider_config()
    runtime = get_runtime_settings()
    num_predict = runtime["llm_num_predict"] if num_predict is None else num_predict
    provider_type = provider_config["type"]
    model = provider_config["model"]
    log_entry["provider"] = provider_config.get("connection_name", provider_type)
    log_entry["model"] = model

    (api_key, system_message, user_prompt, history_messages, valid_slice) = await prepare_request(
        question, context_docs, system_prompt, attachments,
        conversation_history, format_instruction_override, inject_user_profile,
        provider_type, model, conversation_summary, include_skills,
        include_response_language=include_response_language,
    )
    log_entry["system_message"] = system_message
    log_entry["user_prompt"] = user_prompt

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            if provider_type == "openai":
                try:
                    usage: dict = {}
                    pieces = []
                    async for piece in openai_stream(
                            client, model, api_key, system_message, user_prompt,
                            history_messages, valid_slice, attachments, timeout,
                            use_tools=use_tools, usage=usage, call_reason=call_reason,
                            reasoning=reasoning, structured_output_schema=structured_output_schema):
                        pieces.append(piece)
                    if stats_out is not None:
                        stats_out.update({
                            "prompt_eval_count": usage.get("prompt_tokens"),
                            "prompt_eval_duration": usage.get("prompt_eval_duration"),
                            "eval_count": usage.get("completion_tokens"),
                            "eval_duration": usage.get("eval_duration"),
                        })
                    text = "".join(pieces).strip()
                    log_entry["response"] = text
                    return text
                except httpx.HTTPStatusError as e:
                    return openai_err(e, log_entry)

            elif provider_type == "gemini":
                temperature = runtime["llm_temperature"]
                parts: list = [{"text": user_prompt}]
                for att in attachments:
                    if att.get("type") == "image":
                        path = IMAGES_DIR / att["filename"]
                        if path.exists():
                            parts.append({"inline_data": {"mime_type": mime_type(att["filename"]),
                                                          "data": base64.b64encode(path.read_bytes()).decode()}})
                try:
                    log_llm_call(call_reason, "gemini", model, streaming=False, reasoning=reasoning)
                    resp = await client.post(
                        f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={api_key}",
                        json={"systemInstruction": {"parts": [{"text": system_message}]},
                              "contents": [*history_for_gemini(history_messages, valid_slice),
                                           {"role": "user", "parts": parts}],
                              "generationConfig": {"temperature": temperature}})
                    resp.raise_for_status()
                    result = resp.json()
                    log_entry["response"] = result
                    return result["candidates"][0]["content"]["parts"][0]["text"]
                except httpx.HTTPStatusError as e:
                    return gemini_err(e, log_entry)

            elif provider_type == "claude":
                temperature = runtime["llm_temperature"]
                max_tokens = runtime["llm_max_tokens"]
                blocks: list = [{"type": "text", "text": user_prompt}]
                for att in attachments:
                    if att.get("type") == "image":
                        path = IMAGES_DIR / att["filename"]
                        if path.exists():
                            blocks.append({"type": "image",
                                           "source": {"type": "base64",
                                                      "media_type": mime_type(att["filename"]),
                                                      "data": base64.b64encode(path.read_bytes()).decode()}})
                try:
                    log_llm_call(call_reason, "claude", model, streaming=False, reasoning=reasoning)
                    resp = await client.post(
                        "https://api.anthropic.com/v1/messages",
                        headers={"x-api-key": api_key, "anthropic-version": "2023-06-01"},
                        json={"model": model, "max_tokens": max_tokens, "temperature": temperature,
                              "system": system_message,
                              "messages": [*history_for_claude(history_messages, valid_slice),
                                           {"role": "user", "content": blocks}]})
                    resp.raise_for_status()
                    result = resp.json()
                    log_entry["response"] = result
                    text = result["content"][0]["text"]
                    if text.startswith("```") and text.endswith("```"):
                        text = "\n".join(text.split("\n")[1:-1])
                    return text
                except httpx.HTTPStatusError as e:
                    return claude_err(e, log_entry)

            else:
                return f"지원하지 않는 Provider: {provider_type}"

        except Exception as e:
            import traceback
            err_detail = traceback.format_exc()
            log_entry["error"] = f"{type(e).__name__}: {str(e)}\n{err_detail}"
            logger.error("[ERROR] 예상치 못한 에러: %s: %s", type(e).__name__, e)
            logger.error(err_detail)
            await log_llm_interaction(log_entry)
            return f"❌ 오류가 발생했습니다: {type(e).__name__}: {str(e)}"
        finally:
            if not log_entry.get("error"):
                await log_llm_interaction(log_entry)
