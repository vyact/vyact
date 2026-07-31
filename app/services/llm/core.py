"""
services/llm/core.py — 최상위 진입점

chat_stream_with_tools : MCP tool 처리 + 최종 답변 토큰 스트리밍 (4개 provider)
query_llm              : 논스트리밍 단발 응답 (4개 provider)
"""
import asyncio
import base64
import json
import uuid
from datetime import datetime, timezone

import httpx

from prompts import build_system_message, build_user_prompt
from .config import (
    OLLAMA_URL, IMAGES_DIR, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_TEMPERATURE, LLM_MAX_TOKENS, TOP_K, TOP_P,
    OLLAMA_KEEP_ALIVE,
    get_provider_config, log_llm_call, log_llm_interaction, logger,
)
from .helpers import (
    load_images_b64, mime_type,
    history_for_ollama, history_for_openai, history_for_gemini, history_for_claude,
)
from .errors import http_err_msg, openai_err, gemini_err, claude_err
from .ollama import build_ollama_payload, resolve_tool_calls
from .context_window import select_context_window
from .providers import openai_stream, gemini_stream, claude_stream
from .prepare import prepare_request
from services.runtime_settings import get_runtime_settings

_STREAMERS = {"openai": openai_stream, "gemini": gemini_stream, "claude": claude_stream}
_PROVIDER_LABEL = {"openai": "OpenAI", "gemini": "Gemini", "claude": "Claude"}


async def chat_stream_with_tools(
        question: str,
        context_docs: list[dict],
        system_prompt: str = "",
        attachments: list = [],
        conversation_history: list = [],
        timeout: float = 900.0,
        format_instruction_override: str | None = None,
        inject_user_profile: bool = True,
        conversation_summary: str = "",
        use_tools: bool = True,
        reasoning: bool = True,
        post_tool_docs=None,
        call_reason: str = "unspecified",
):
    """MCP tool 처리 + 최종 답변 토큰 스트리밍 (모든 provider 지원).

    dict 이벤트를 yield 한다:
      {"type": "tool",  "phase": "start"/"end", "name": ..., "args": ...}
      {"type": "token", "text": <조각>}
      {"type": "rag_fallback", "docs": [...]}  (ollama만 해당, post_tool_docs 지정 시)

    provider별로 tool 루프(function-calling) 후 최종 답변을 SSE로 스트리밍한다.
    use_tools=False 이면 tool 판정을 건너뛴다(선택 문서 기반 질의 등).

    post_tool_docs: async (tool_got_sources: bool) -> list[dict]  (ollama 전용, 선택)
        tool 판정 라운드가 끝나면 항상 한 번 호출된다. 인자로 "tool이 sources를
        가져왔는지"를 넘겨주므로, 호출부에서 다음처럼 알아서 판단하면 된다:
          - tool_got_sources=True  → 메모처럼 tool과 무관하게 항상 필요한 것만 조회
          - tool_got_sources=False → 메모 + ES(RAG) 뉴스를 병행 조회해서 보충
        (tool을 안 썼거나, 썼는데도 결과가 없을 때 모두 False로 들어온다.)
    """
    provider_config = await get_provider_config()
    provider_type = provider_config["type"]

    # ── 비-Ollama provider (openai / gemini / claude) ──
    if provider_type != "ollama":
        model = provider_config["model"]
        collected: list[str] = []
        tools_used: list[str] = []
        log_entry = {
            "request_id": str(uuid.uuid4()),
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "provider": provider_type, "model": model,
            "docs_count": len(context_docs),
            "streaming": True, "response": None, "error": None,
        }
        try:
            (api_key, sys_msg, usr_msg, history_messages, valid_slice) = await prepare_request(
                question, context_docs, system_prompt, attachments,
                conversation_history, format_instruction_override, inject_user_profile,
                provider_type, model, conversation_summary,
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
                               call_reason=call_reason)

                # streamer는 async generator. tool 루프는 첫 토큰 전에 끝나고,
                # 그 사이 on_event가 큐에 tool 이벤트를 넣는다.
                # 큐와 토큰을 함께 흘리기 위해, 토큰 소비 태스크를 돌리며 큐를 먼저 비운다.
                async def _pump_tokens():
                    async for piece in gen:
                        await _queue.put({"type": "token", "text": piece})
                    await _queue.put({"__done__": True})

                pump = asyncio.create_task(_pump_tokens())
                try:
                    while True:
                        ev = await _queue.get()
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
                # OpenAI/Gemini/Claude는 처리시간(*_duration)은 안 주므로 토큰수만 채운다.
                stats = {
                    "prompt_eval_count": usage.get("prompt_tokens"),
                    "prompt_eval_duration": None,
                    "eval_count": usage.get("completion_tokens"),
                    "eval_duration": None,
                    "total_duration": None,
                }
                log_entry["stats"] = stats
                yield {"type": "stats", **stats}
        except httpx.HTTPStatusError as e:
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

    # ── Ollama ──
    model, body = await build_ollama_payload(
        question, context_docs, system_prompt, attachments, conversation_history,
        format_instruction_override, inject_user_profile, conversation_summary, reasoning=reasoning,
    )

    if use_tools:
        _queue: "asyncio.Queue[dict]" = asyncio.Queue()
        _DONE = {"__done__": True}
        _collected_tool_sources: list = []

        async def _on_tool_event(ev: dict):
            if ev.get("phase") == "end" and ev.get("sources"):
                _collected_tool_sources.extend(ev["sources"])
            await _queue.put({"type": "tool", **ev})

        async def _run_loop():
            try:
                return await resolve_tool_calls(
                    model, body["messages"], body.get("options", {}), timeout,
                    on_event=_on_tool_event, call_reason=call_reason,
                    reasoning=reasoning,
                )
            except Exception as e:
                logger.warning("[chat_stream_with_tools] tool 루프 실패, 무시하고 진행: %s", e)
                return {"messages": body["messages"], "direct_answer": None, "stats": None}
            finally:
                await _queue.put(_DONE)

        loop_task = asyncio.create_task(_run_loop())
        try:
            while True:
                ev = await _queue.get()
                if ev is _DONE:
                    break
                yield ev
        except (asyncio.CancelledError, GeneratorExit):
            loop_task.cancel()
            try:
                await loop_task
            except asyncio.CancelledError:
                pass
            logger.info("[chat_stream_with_tools] 클라이언트 종료 — tool 루프 취소")
            return

        loop_result = await loop_task
        new_messages = loop_result["messages"]
        direct_answer = loop_result["direct_answer"]
        direct_stats = loop_result["stats"]
        body["messages"] = new_messages

        # post_tool_docs 호출 (메모/RAG 지연조회)
        if post_tool_docs is not None:
            try:
                extra_docs = await post_tool_docs(bool(_collected_tool_sources)) or []
            except Exception as e:
                logger.warning("[chat_stream_with_tools] post_tool_docs 실패: %s", e)
                extra_docs = []
            if extra_docs:
                direct_answer = None
                yield {"type": "rag_fallback", "docs": extra_docs}
                combined_docs = list(context_docs) + list(extra_docs)
                new_user_prompt = build_user_prompt(question, combined_docs, attachments, model)
                for i in range(len(body["messages"]) - 1, -1, -1):
                    if body["messages"][i].get("role") == "user":
                        body["messages"][i] = {**body["messages"][i], "content": new_user_prompt}
                        break
    else:
        direct_answer = None
        direct_stats = None

    # tool 루프에서 합산된 stats (재생성 호출 stats와 최종 병합용)
    tool_loop_stats: dict | None = direct_stats if (direct_stats and direct_stats.get("llm_rounds")) else None

    _sys_msg = ""
    _usr_msg = ""
    for _m in body.get("messages", []):
        if _m.get("role") == "system" and not _sys_msg:
            _sys_msg = _m.get("content", "")
        if _m.get("role") == "user":
            _usr_msg = _m.get("content", "")
    _tool_msgs = [_m for _m in body.get("messages", []) if _m.get("role") == "tool"]
    log_entry = {
        "request_id": str(uuid.uuid4()),
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "provider": "ollama", "model": model,
        "system_message": _sys_msg, "user_prompt": _usr_msg,
        "docs_count": len(context_docs),
        "tools_used": [_m.get("name") for _m in _tool_msgs] or None,
        "tool_results": [
                            {"name": _m.get("name"), "content": _m.get("content", "")}
                            for _m in _tool_msgs
                        ] or None,
        "origin_response": None, "response": None, "error": None,
        "streaming": True,
    }
    collected: list[str] = []

    _STOP_TOKENS = ("<|endoftext|>", "<|im_start|>", "<|im_end|>")
    stopped = False
    stats: dict | None = None
    ignored_tool_calls: list[dict] = []

    if direct_answer is not None:
        # tool 판정 호출이 이미 완성된 답변을 만들어놨고, 그 이후 컨텍스트 변경(post_tool_docs)도
        # 없었으므로 재생성용 스트리밍 호출을 건너뛰고 그 답변을 그대로 재사용한다.
        # (tool 미사용 케이스에서 LLM 호출을 2번 → 1번으로 줄이는 지점)
        logger.info(
            "[llm_call] reason=%s provider=ollama model=%s streaming=False kind=skipped "
            "판정 호출 답변 재사용 — 재생성 스트리밍 생략",
            call_reason, model,
        )
        text = direct_answer
        for tok in _STOP_TOKENS:
            if tok in text:
                text = text.split(tok)[0]
                break
        # 프론트 타이핑 효과 유지를 위해 의사-스트리밍으로 잘게 흘려보냄
        CHUNK_SIZE = 12
        for i in range(0, len(text), CHUNK_SIZE):
            piece = text[i:i + CHUNK_SIZE]
            collected.append(piece)
            yield {"type": "token", "text": piece}
            await asyncio.sleep(0)
        stats = direct_stats
        if stats:
            yield {"type": "stats", **stats}
        log_entry["response"] = "".join(collected)
        log_entry["stats"] = stats
        log_entry["reused_judgment_answer"] = True
        try:
            await log_llm_interaction(log_entry)
        except Exception as _le:
            logger.warning("[chat_stream_with_tools] 로그 저장 실패: %s", _le)
        return

    log_llm_call(call_reason, "ollama", model, streaming=True, reasoning=reasoning)
    try:
        async with httpx.AsyncClient(timeout=timeout) as client:
            async with client.stream(
                    "POST", f"{OLLAMA_URL}/api/chat",
                    headers={"Content-Type": "application/json"},
                    json=body,
            ) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line.strip():
                        continue
                    try:
                        chunk = json.loads(line)
                    except json.JSONDecodeError:
                        continue
                    # 최종 답변 호출에는 tools 스키마를 보내지 않지만, 일부 로컬 모델은
                    # 직전 tool-call 문맥을 보고 다시 tool_calls만 반환한다. 이 경우 content가
                    # 비어 프론트가 "응답 생성 실패"로 처리하므로, 아래에서 텍스트 전용 재시도를 한다.
                    ignored_tool_calls = chunk.get("message", {}).get("tool_calls") or ignored_tool_calls
                    piece = chunk.get("message", {}).get("content", "")
                    if piece:
                        for tok in _STOP_TOKENS:
                            if tok in piece:
                                piece = piece.split(tok)[0]
                                stopped = True
                                break
                        if piece:
                            collected.append(piece)
                            yield {"type": "token", "text": piece}
                    if chunk.get("done"):
                        # Ollama가 마지막 청크에 붙여주는 토큰수/처리시간 통계
                        # (prompt_eval_*: 입력 토큰/시간, eval_*: 생성 토큰/시간, total_duration: 전체 소요시간, 단위 ns)
                        stats = {
                            "load_duration": chunk.get("load_duration"),
                            "prompt_eval_count": chunk.get("prompt_eval_count"),
                            "prompt_eval_duration": chunk.get("prompt_eval_duration"),
                            "eval_count": chunk.get("eval_count"),
                            "eval_duration": chunk.get("eval_duration"),
                            "total_duration": chunk.get("total_duration"),
                        }
                    if stopped or chunk.get("done"):
                        break

        if not collected and not stopped and _tool_msgs:
            logger.warning(
                "[chat_stream_with_tools] tool 이후 최종 응답이 비어 텍스트 전용 재시도: %s",
                [call.get("function", {}).get("name") for call in ignored_tool_calls] or "content 없음",
            )
            recovery_body = {
                **body,
                "messages": [
                    *body["messages"],
                    {
                        "role": "user",
                        "content": (
                            "도구 실행은 이미 완료되었습니다. 위 도구 결과만 근거로 "
                            "사용자에게 보여줄 최종 답변을 작성하세요. 추가 도구 호출이나 설명 없이 "
                            "답변 본문만 출력하세요."
                        ),
                    },
                ],
            }
            async with httpx.AsyncClient(timeout=timeout) as client:
                async with client.stream(
                        "POST", f"{OLLAMA_URL}/api/chat",
                        headers={"Content-Type": "application/json"}, json=recovery_body,
                ) as resp:
                    resp.raise_for_status()
                    async for line in resp.aiter_lines():
                        if not line.strip():
                            continue
                        try:
                            chunk = json.loads(line)
                        except json.JSONDecodeError:
                            continue
                        piece = chunk.get("message", {}).get("content", "")
                        if piece:
                            collected.append(piece)
                            yield {"type": "token", "text": piece}
                        if chunk.get("done"):
                            stats = {
                                "load_duration": chunk.get("load_duration"),
                                "prompt_eval_count": chunk.get("prompt_eval_count"),
                                "prompt_eval_duration": chunk.get("prompt_eval_duration"),
                                "eval_count": chunk.get("eval_count"),
                                "eval_duration": chunk.get("eval_duration"),
                                "total_duration": chunk.get("total_duration"),
                            }
                            break
        if not collected and not stopped:
            logger.warning("[chat_stream_with_tools] Ollama completed without response content")
            message = "__VYACT_EMPTY_RESPONSE__"
            collected.append(message)
            yield {"type": "token", "text": message}
        # 재생성 호출 stats에 tool 루프 합산 정보 병합
        if stats and tool_loop_stats:
            regen_total = stats.get("total_duration") or 0
            stats["llm_total_duration"] = (tool_loop_stats.get("llm_total_duration") or 0) + regen_total
            stats["tool_duration"] = tool_loop_stats.get("tool_duration", 0)
            stats["tool_call_count"] = tool_loop_stats.get("tool_call_count", 0)
            stats["llm_rounds"] = (tool_loop_stats.get("llm_rounds") or 0) + 1
        if stats:
            yield {"type": "stats", **stats}
    except Exception as e:
        logger.error("[chat_stream_with_tools] Ollama 스트리밍 실패: %s", e)
        log_entry["error"] = f"{type(e).__name__}: {e}"
        yield {"type": "token", "text": f"\n\n❌ 스트리밍 중 오류가 발생했습니다: {type(e).__name__}"}
    finally:
        log_entry["response"] = "".join(collected)
        log_entry["stats"] = stats
        try:
            await log_llm_interaction(log_entry)
        except Exception as _le:
            logger.warning("[chat_stream_with_tools] 로그 저장 실패: %s", _le)


async def collect_llm_stream(
        question: str,
        context_docs: list[dict],
        system_prompt: str = "",
        attachments: list = [],
        conversation_history: list = [],
        timeout: float = 900.0,
        format_instruction_override: str | None = None,
        inject_user_profile: bool = True,
        conversation_summary: str = "",
        use_tools: bool = True,
        reasoning: bool = True,
        call_reason: str = "unspecified",
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
            reasoning=reasoning, call_reason=call_reason,
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
        attachments: list = [],
        conversation_history: list = [],
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
) -> str:
    """논스트리밍 단발 응답 (모든 provider).

    stats_out: 호출부가 빈 dict를 넘기면 ollama 응답의 토큰수/처리시간 통계
    (prompt_eval_count 등)를 채워 넣는다 (다른 provider는 채우지 않음).

    use_tools=False 이면 MCP tool 판정/루프를 건너뛴다. 번역처럼 tool이
    전혀 필요 없는 단발 호출에서 불필요한 tool 판정 왕복을 없애 속도를 높인다.

    reasoning=False 이면 Ollama(gemma)의 thinking(추론) 단계를 끈다(think:false).
    번역은 항상 reasoning=False 로 호출한다.

    structured_output_schema를 지정하면 Ollama의 ``format`` 요청 필드에 JSON
    Schema를 전달한다. 다른 provider는 기존 프롬프트 기반 동작을 유지한다.
    """
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
    log_entry["provider"] = provider_type
    log_entry["model"] = model

    (api_key, system_message, user_prompt, history_messages, valid_slice) = await prepare_request(
        question, context_docs, system_prompt, attachments,
        conversation_history, format_instruction_override, inject_user_profile,
        provider_type, model, conversation_summary, include_skills,
    )
    log_entry["system_message"] = system_message
    log_entry["user_prompt"] = user_prompt

    async with httpx.AsyncClient(timeout=timeout) as client:
        try:
            if provider_type == "ollama":
                images_b64 = load_images_b64(attachments)
                user_msg: dict = {"role": "user", "content": user_prompt}
                if images_b64:
                    user_msg["images"] = images_b64
                ollama_messages = [{"role": "system", "content": system_message},
                                   *history_for_ollama(history_messages, valid_slice), user_msg]
                ollama_options = {
                    "num_ctx": select_context_window(ollama_messages, runtime["llm_num_ctx"], runtime["history_chars_per_token"], num_predict),
                    "num_predict": num_predict,
                    "temperature": runtime["llm_temperature"]
                }
                if top_k is not None:
                    ollama_options["top_k"] = top_k
                if top_p is not None:
                    ollama_options["top_p"] = top_p
                direct_answer = None
                if use_tools:
                    try:
                        loop_result = await resolve_tool_calls(
                            model, ollama_messages, ollama_options, timeout,
                            call_reason=call_reason, reasoning=reasoning,
                        )
                        ollama_messages = loop_result["messages"]
                        direct_answer = loop_result["direct_answer"]
                        if stats_out is not None and loop_result.get("stats"):
                            stats_out.update(loop_result["stats"])
                    except Exception as e:
                        logger.warning("[query_llm] tool 루프 실패, 무시하고 진행: %s", e)

                if direct_answer is not None:
                    # 판정 호출이 이미 완성된 답변을 만들어놨으므로 재호출 없이 그대로 반환
                    # (tool 미사용 케이스에서 LLM 호출 2번 → 1번으로 절약)
                    logger.info(
                        "[llm_call] reason=%s provider=ollama model=%s streaming=False kind=skipped "
                        "판정 호출 답변 재사용 — 재호출 생략",
                        call_reason, model,
                    )
                    return direct_answer.strip()

                ollama_body: dict = {"model": model, "stream": False,
                                     "messages": ollama_messages,
                                     "options": ollama_options,
                                     "keep_alive": OLLAMA_KEEP_ALIVE}
                if structured_output_schema is not None:
                    ollama_body["format"] = structured_output_schema
                if not reasoning:
                    ollama_body["think"] = False
                log_llm_call(call_reason, "ollama", model, streaming=False, reasoning=reasoning)
                resp = await client.post(
                    f"{OLLAMA_URL}/api/chat",
                    headers={"Content-Type": "application/json"},
                    json=ollama_body,
                )
                resp.raise_for_status()
                log_entry["origin_response"] = resp.text
                result = resp.json()
                log_entry["response"] = result
                # prompt_eval_count : 모델이 입력으로 받은 토큰 수
                # load_duration : 모델 로드 시간(ns)
                # prompt_eval_duration : 입력 토큰 처리 시간(ns)
                # eval_count : 모델이 생성한 출력 토큰 수
                # eval_duration : 출력 토큰 생성 시간(ns)
                # logger.info(
                #     "[translate] ollama stats prompt_eval_count=%s eval_count=%s "
                #     "prompt_eval_duration=%.2fs eval_duration=%.2fs total_duration=%.2fs "
                #     "messages=%s "
                #     "options=%s",
                #     result.get("prompt_eval_count"),
                #     result.get("eval_count"),
                #     result.get("prompt_eval_duration", 0) / 1_000_000_000,
                #     result.get("eval_duration", 0) / 1_000_000_000,
                #     result.get("total_duration", 0) / 1_000_000_000,
                #     ollama_messages,
                #     ollama_options
                # )
                if stats_out is not None and (
                        result.get("prompt_eval_count") is not None
                        or result.get("eval_count") is not None):
                    regen_stats = {
                        "load_duration": result.get("load_duration"),
                        "prompt_eval_count": result.get("prompt_eval_count"),
                        "prompt_eval_duration": result.get("prompt_eval_duration"),
                        "eval_count": result.get("eval_count"),
                        "eval_duration": result.get("eval_duration"),
                        "total_duration": result.get("total_duration"),
                    }
                    # tool 루프 합산 stats가 이미 있으면 병합
                    prev = dict(stats_out) if stats_out.get("llm_total_duration") else None
                    stats_out.update(regen_stats)
                    if prev:
                        regen_total = result.get("total_duration") or 0
                        stats_out["llm_total_duration"] = (prev.get("llm_total_duration") or 0) + regen_total
                        stats_out["tool_duration"] = prev.get("tool_duration", 0)
                        stats_out["tool_call_count"] = prev.get("tool_call_count", 0)
                        stats_out["llm_rounds"] = (prev.get("llm_rounds") or 0) + 1
                text = result.get("message", {}).get("content", "응답을 생성할 수 없습니다.")
                for token in ("<|endoftext|>", "<|im_start|>", "<|im_end|>"):
                    text = text.split(token)[0]
                return text.strip()

            elif provider_type == "openai":
                temperature = runtime["llm_temperature"]
                images_b64 = load_images_b64(attachments)
                if images_b64:
                    content: list = [{"type": "text", "text": user_prompt}]
                    for b64 in images_b64:
                        content.append({"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{b64}"}})
                    user_msg = {"role": "user", "content": content}
                else:
                    user_msg = {"role": "user", "content": user_prompt}
                body: dict = {"model": model, "temperature": temperature,
                              "messages": [{"role": "system", "content": system_message},
                                           *history_for_openai(history_messages, valid_slice), user_msg]}
                try:
                    log_llm_call(call_reason, "openai", model, streaming=False, reasoning=reasoning)
                    resp = await client.post("https://api.openai.com/v1/chat/completions",
                                             headers={"Authorization": f"Bearer {api_key}"},
                                             json=body)
                    resp.raise_for_status()
                    result = resp.json()
                    log_entry["response"] = result
                    return result["choices"][0]["message"]["content"]
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
