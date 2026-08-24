"""
services/llm/providers.py — OpenAI / Gemini / Claude 요청·tool 루프·스트리밍

각 provider의 function-calling 규격에 맞춰 MCP tool을 사용한다.
1) tool 루프(비스트리밍): tool_call이 나오면 mcp_manager로 실행하고 결과를 재주입,
   더 이상 tool_call이 없을 때까지 반복.
2) 최종 답변: provider의 SSE 스트리밍으로 토큰 조각을 async yield.

tool 진행 이벤트는 on_event 콜백(coroutine)으로 알린다:
  {"phase":"start","name":...,"args":...}  /  {"phase":"end","name":...}
"""
import base64
import json

from .config import (
    IMAGES_DIR, LLM_TEMPERATURE, LLM_MAX_TOKENS, TOOL_CALL_MAX_ROUNDS,
    build_provider_headers, get_provider_config, log_llm_call, log_llm_interaction, log_tool_names, logger,
)
from .helpers import (
    image_attachment_path, load_image_data_urls, mime_type,
    history_for_openai, history_for_gemini, history_for_claude,
)
from .tools import (
    build_approval_rejection_instruction, build_tool_directive,
    to_openai_tools, to_gemini_tools, to_claude_tools,
)
from services.runtime_settings import get_runtime_settings
from services.tool_approval import await_tool_approval


async def _get_unified_tools(use_tools: bool):
    """MCP tool(통일형)과 tool 이름 목록을 반환. tool이 없으면 ([], [])."""
    if not use_tools:
        return [], []
    try:
        from services.mcp_client import mcp_manager
        if not mcp_manager.connected or not mcp_manager.has_tools():
            return [], []
        unified = await mcp_manager.get_tools()
        names = [t["function"]["name"] for t in unified]
        await log_tool_names(names, reason="provider")
        return unified, names
    except Exception as e:
        logger.warning("[providers] tool 목록 조회 실패: %s", e)
        return [], []


async def _emit(on_event, ev: dict):
    if on_event is not None:
        try:
            await on_event(ev)
        except Exception:
            pass


# ══════════════════════════════════════════════════════════════════
# OpenAI
# ══════════════════════════════════════════════════════════════════
async def openai_stream(client, model, api_key, system_message, user_prompt,
                        history_messages, valid_slice, attachments,
                        timeout, use_tools=True, on_event=None, usage: dict | None = None,
                        call_reason: str = "unspecified", reasoning: bool | None = None,
                        post_tool_docs=None, post_tool_prompt=None,
                        structured_output_schema: dict | None = None):
    """OpenAI: tool 루프(있으면) 후 최종 답변 SSE 스트리밍.

    usage(dict)를 넘기면 최종 청크의 토큰 사용량(prompt_tokens/completion_tokens)을
    그 안에 채워 넣는다 (호출자가 스트리밍 종료 후 읽어간다).
    """
    temperature = get_runtime_settings()["llm_temperature"]
    image_urls = load_image_data_urls(attachments)
    if image_urls:
        content: list = [{"type": "text", "text": user_prompt}]
        for image_url in image_urls:
            content.append({"type": "image_url",
                            "image_url": {"url": image_url}})
        user_msg = {"role": "user", "content": content}
    else:
        user_msg = {"role": "user", "content": user_prompt}

    unified, names = await _get_unified_tools(use_tools)
    sys_content = system_message
    if names:
        sys_content = system_message + await build_tool_directive(names)

    messages = [{"role": "system", "content": sys_content},
                *history_for_openai(history_messages, valid_slice), user_msg]
    user_message_index = len(messages) - 1

    headers = build_provider_headers(await get_provider_config())
    provider_config = await get_provider_config()
    configured_base_url = provider_config.get("base_url")
    base_url = (
        f"{configured_base_url.rstrip('/')}/chat/completions"
        if configured_base_url
        else "https://api.openai.com/v1/chat/completions"
    )

    # ── tool 루프 (비스트리밍) ──
    approval_rejected = False
    completed_tool_names: set[str] = set()
    tool_sources_found = False
    if unified:
        oa_tools = to_openai_tools(unified)
        for _round in range(TOOL_CALL_MAX_ROUNDS):
            body = {"model": model, "temperature": temperature,
                    "messages": messages, "tools": oa_tools}
            log_llm_call(call_reason, "openai", model, streaming=False, reasoning=reasoning,
                         is_tool_judgment=True, round_no=_round)
            resp = await client.post(base_url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            choice = (data.get("choices") or [{}])[0]
            amsg = choice.get("message", {}) or {}
            tool_calls = amsg.get("tool_calls") or []
            if not tool_calls:
                break
            # assistant tool_calls 메시지 추가
            messages.append({"role": "assistant",
                             "content": amsg.get("content") or "",
                             "tool_calls": tool_calls})
            from services.mcp_client import mcp_manager
            for tc in tool_calls:
                fn = tc.get("function", {}) or {}
                name = fn.get("name", "")
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    args = {}
                if approval_rejected:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다.",
                    })
                    continue
                approved = await await_tool_approval(name, args, lambda event: _emit(on_event, event))
                if not approved:
                    result_text = "[사용자 거부] 사용자가 이 tool 실행을 승인하지 않았습니다."
                    await _emit(on_event, {"phase": "approval_rejected", "name": name, "args": args, "result": result_text})
                    messages.append({"role": "tool", "tool_call_id": tc.get("id", ""), "content": result_text})
                    messages[0]["content"] += build_approval_rejection_instruction(name)
                    approval_rejected = True
                    continue
                await _emit(on_event, {"phase": "start", "name": name, "args": args})
                result_text = await mcp_manager.call_tool(name, args)
                tool_sources = mcp_manager.drain_tool_sources()
                if not str(result_text).startswith("[오류]"):
                    completed_tool_names.add(name)
                tool_sources_found = tool_sources_found or bool(tool_sources)
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": result_text})
            if approval_rejected:
                break

    if post_tool_docs is not None:
        extra_docs = await post_tool_docs(tool_sources_found, completed_tool_names) or []
        if extra_docs and post_tool_prompt is not None:
            updated_prompt = post_tool_prompt(extra_docs)
            if isinstance(messages[user_message_index].get("content"), list):
                messages[user_message_index]["content"][0] = {"type": "text", "text": updated_prompt}
            else:
                messages[user_message_index]["content"] = updated_prompt
            await _emit(on_event, {"phase": "rag_fallback", "docs": extra_docs})

    # ── 최종 답변 스트리밍 ──
    body = {"model": model, "temperature": temperature, "stream": True, "messages": messages}
    if provider_config.get("is_local"):
        runtime = get_runtime_settings()
        body["max_tokens"] = runtime["llm_num_predict"]
        if runtime.get("top_p") is not None:
            body["top_p"] = runtime["top_p"]
        if provider_config.get("runtime") == "gguf":
            body["chat_template_kwargs"] = {"enable_thinking": bool(reasoning)}
            if runtime.get("top_k") is not None:
                body["top_k"] = runtime["top_k"]
            if structured_output_schema is not None:
                body["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": "vyact_response", "schema": structured_output_schema},
                }
    if usage is not None:
        # stream=True에서도 마지막 청크에 usage를 실어 보내도록 요청 (choices는 빈 배열로 옴)
        body["stream_options"] = {"include_usage": True}
    log_llm_call(call_reason, "openai", model, streaming=True, reasoning=reasoning)
    async with client.stream("POST", base_url, headers=headers, json=body) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if data == "[DONE]":
                break
            try:
                chunk = json.loads(data)
            except json.JSONDecodeError:
                continue
            if usage is not None:
                u = chunk.get("usage")
                if u:
                    usage["prompt_tokens"] = u.get("prompt_tokens")
                    usage["completion_tokens"] = u.get("completion_tokens")
                timings = chunk.get("timings")
                if isinstance(timings, dict):
                    usage["prompt_eval_duration"] = _milliseconds_to_nanoseconds(timings.get("prompt_ms"))
                    usage["eval_duration"] = _milliseconds_to_nanoseconds(timings.get("predicted_ms"))
                    usage["prompt_tokens"] = usage.get("prompt_tokens") or timings.get("prompt_n")
                    usage["completion_tokens"] = usage.get("completion_tokens") or timings.get("predicted_n")
                    usage["prompt_tokens_per_second"] = timings.get("prompt_per_second")
                    usage["completion_tokens_per_second"] = timings.get("predicted_per_second")
                    usage["draft_tokens"] = timings.get("draft_n")
                    usage["accepted_draft_tokens"] = timings.get("draft_n_accepted")
            choices = chunk.get("choices") or []
            if choices:
                choice = choices[0]
                finish_reason = choice.get("finish_reason")
                if usage is not None and finish_reason:
                    usage["finish_reason"] = finish_reason
                piece = choice.get("delta", {}).get("content")
                if piece:
                    yield piece


def _milliseconds_to_nanoseconds(value) -> int | None:
    if not isinstance(value, (int, float)):
        return None
    return max(0, round(value * 1_000_000))


# ══════════════════════════════════════════════════════════════════
# Gemini
# ══════════════════════════════════════════════════════════════════
async def gemini_stream(client, model, api_key, system_message, user_prompt,
                        history_messages, valid_slice, attachments,
                        timeout, use_tools=True, on_event=None, usage: dict | None = None,
                        call_reason: str = "unspecified", reasoning: bool | None = None):
    """Gemini: tool 루프(있으면) 후 최종 답변 SSE 스트리밍.

    usage(dict)를 넘기면 매 청크의 usageMetadata(누적치)로 계속 덮어써서,
    스트림이 끝났을 때 최종 토큰 사용량이 남도록 한다.
    """
    temperature = get_runtime_settings()["llm_temperature"]
    unified, names = await _get_unified_tools(use_tools)
    sys_text = system_message
    if names:
        sys_text = system_message + await build_tool_directive(names)

    # systemInstruction을 별도 필드로 유지해야 정적 시스템 규칙이 히스토리보다
    # 항상 앞에 오며 provider의 prefix cache를 재사용할 수 있다.
    parts: list = [{"text": user_prompt}]
    for att in attachments:
        if att.get("type") == "image":
            path = image_attachment_path(att)
            if path.exists():
                parts.append({"inline_data": {"mime_type": mime_type(att["filename"]),
                                              "data": base64.b64encode(path.read_bytes()).decode()}})

    contents = [*history_for_gemini(history_messages, valid_slice),
                {"role": "user", "parts": parts}]

    gen_url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
               f"{model}:generateContent?key={api_key}")
    stream_url = (f"https://generativelanguage.googleapis.com/v1beta/models/"
                  f"{model}:streamGenerateContent?alt=sse&key={api_key}")
    gen_cfg = {"temperature": temperature}

    # ── tool 루프 (비스트리밍) ──
    approval_rejected = False
    if unified:
        gm_tools = to_gemini_tools(unified)
        for _round in range(TOOL_CALL_MAX_ROUNDS):
            body = {
                "systemInstruction": {"parts": [{"text": sys_text}]},
                "contents": contents,
                "generationConfig": gen_cfg,
                "tools": gm_tools,
            }
            log_llm_call(call_reason, "gemini", model, streaming=False, reasoning=reasoning,
                         is_tool_judgment=True, round_no=_round)
            resp = await client.post(gen_url, json=body)
            resp.raise_for_status()
            data = resp.json()
            cands = data.get("candidates") or []
            if not cands:
                break
            cparts = cands[0].get("content", {}).get("parts", []) or []
            fcalls = [p["functionCall"] for p in cparts if "functionCall" in p]
            if not fcalls:
                break
            # 모델 turn(functionCall 포함) 기록
            contents.append({"role": "model", "parts": cparts})
            from services.mcp_client import mcp_manager
            resp_parts = []
            for fc in fcalls:
                name = fc.get("name", "")
                args = fc.get("args", {}) or {}
                if approval_rejected:
                    resp_parts.append({"functionResponse": {
                        "name": name,
                        "response": {"result": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다."},
                    }})
                    continue
                approved = await await_tool_approval(name, args, lambda event: _emit(on_event, event))
                if not approved:
                    result_text = "[사용자 거부] 사용자가 이 tool 실행을 승인하지 않았습니다."
                    await _emit(on_event, {"phase": "approval_rejected", "name": name, "args": args, "result": result_text})
                    resp_parts.append({"functionResponse": {"name": name, "response": {"result": result_text}}})
                    sys_text += build_approval_rejection_instruction(name)
                    approval_rejected = True
                    continue
                await _emit(on_event, {"phase": "start", "name": name, "args": args})
                result_text = await mcp_manager.call_tool(name, args)
                tool_sources = mcp_manager.drain_tool_sources()
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                resp_parts.append({"functionResponse": {
                    "name": name, "response": {"result": result_text}}})
            contents.append({"role": "user", "parts": resp_parts})
            if approval_rejected:
                break

    # ── 최종 답변 스트리밍 ──
    body = {
        "systemInstruction": {"parts": [{"text": sys_text}]},
        "contents": contents,
        "generationConfig": gen_cfg,
    }
    if unified and not approval_rejected:
        body["tools"] = to_gemini_tools(unified)
    log_llm_call(call_reason, "gemini", model, streaming=True, reasoning=reasoning)
    async with client.stream("POST", stream_url, json=body) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if not data:
                continue
            try:
                chunk = json.loads(data)
                if usage is not None:
                    um = chunk.get("usageMetadata")
                    if um:
                        usage["prompt_tokens"] = um.get("promptTokenCount")
                        usage["completion_tokens"] = um.get("candidatesTokenCount")
                cands = chunk.get("candidates") or []
                if not cands:
                    continue
                for p in cands[0].get("content", {}).get("parts", []):
                    piece = p.get("text")
                    if piece:
                        yield piece
            except json.JSONDecodeError:
                continue


# ══════════════════════════════════════════════════════════════════
# Claude
# ══════════════════════════════════════════════════════════════════
async def claude_stream(client, model, api_key, system_message, user_prompt,
                        history_messages, valid_slice, attachments,
                        timeout, use_tools=True, on_event=None, usage: dict | None = None,
                        call_reason: str = "unspecified", reasoning: bool | None = None):
    """Claude: tool 루프(있으면) 후 최종 답변 SSE 스트리밍.

    usage(dict)를 넘기면 message_start의 input_tokens, message_delta의
    output_tokens(누적치)를 채워 넣는다.
    """
    runtime = get_runtime_settings()
    temperature = runtime["llm_temperature"]
    max_tokens = runtime["llm_max_tokens"]
    blocks: list = [{"type": "text", "text": user_prompt}]
    for att in attachments:
        if att.get("type") == "image":
            path = image_attachment_path(att)
            if path.exists():
                blocks.append({"type": "image", "source": {
                    "type": "base64", "media_type": mime_type(att["filename"]),
                    "data": base64.b64encode(path.read_bytes()).decode()}})

    unified, names = await _get_unified_tools(use_tools)
    system_text = system_message
    if names:
        system_text = system_message + await build_tool_directive(names)

    messages = [*history_for_claude(history_messages, valid_slice),
                {"role": "user", "content": blocks}]

    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    base_url = "https://api.anthropic.com/v1/messages"

    # ── tool 루프 (비스트리밍) ──
    approval_rejected = False
    if unified:
        cl_tools = to_claude_tools(unified)
        for _round in range(TOOL_CALL_MAX_ROUNDS):
            body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
                    "system": system_text, "messages": messages, "tools": cl_tools}
            log_llm_call(call_reason, "claude", model, streaming=False, reasoning=reasoning,
                         is_tool_judgment=True, round_no=_round)
            resp = await client.post(base_url, headers=headers, json=body)
            resp.raise_for_status()
            data = resp.json()
            content_blocks = data.get("content", []) or []
            tool_uses = [b for b in content_blocks if b.get("type") == "tool_use"]
            if not tool_uses:
                break
            # assistant turn(전체 content blocks) 기록
            messages.append({"role": "assistant", "content": content_blocks})
            from services.mcp_client import mcp_manager
            result_blocks = []
            for tu in tool_uses:
                name = tu.get("name", "")
                args = tu.get("input", {}) or {}
                if approval_rejected:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다.",
                    })
                    continue
                approved = await await_tool_approval(name, args, lambda event: _emit(on_event, event))
                if not approved:
                    result_text = "[사용자 거부] 사용자가 이 tool 실행을 승인하지 않았습니다."
                    await _emit(on_event, {"phase": "approval_rejected", "name": name, "args": args, "result": result_text})
                    result_blocks.append({"type": "tool_result", "tool_use_id": tu.get("id", ""), "content": result_text})
                    system_text += build_approval_rejection_instruction(name)
                    approval_rejected = True
                    continue
                await _emit(on_event, {"phase": "start", "name": name, "args": args})
                result_text = await mcp_manager.call_tool(name, args)
                tool_sources = mcp_manager.drain_tool_sources()
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                result_blocks.append({"type": "tool_result",
                                      "tool_use_id": tu.get("id", ""),
                                      "content": result_text})
            messages.append({"role": "user", "content": result_blocks})
            if approval_rejected:
                break

    # ── 최종 답변 스트리밍 ──
    body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
            "system": system_text, "stream": True, "messages": messages}
    if unified and not approval_rejected:
        body["tools"] = to_claude_tools(unified)
    log_llm_call(call_reason, "claude", model, streaming=True, reasoning=reasoning)
    async with client.stream("POST", base_url, headers=headers, json=body) as resp:
        resp.raise_for_status()
        async for line in resp.aiter_lines():
            if not line or not line.startswith("data:"):
                continue
            data = line[len("data:"):].strip()
            if not data:
                continue
            try:
                evt = json.loads(data)
                if usage is not None:
                    evt_type = evt.get("type")
                    if evt_type == "message_start":
                        u = evt.get("message", {}).get("usage", {}) or {}
                        if u.get("input_tokens") is not None:
                            usage["prompt_tokens"] = u.get("input_tokens")
                    elif evt_type == "message_delta":
                        u = evt.get("usage", {}) or {}
                        if u.get("output_tokens") is not None:
                            usage["completion_tokens"] = u.get("output_tokens")
                if evt.get("type") == "content_block_delta":
                    piece = evt.get("delta", {}).get("text")
                    if piece:
                        yield piece
            except json.JSONDecodeError:
                continue
