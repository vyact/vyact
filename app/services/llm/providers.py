"""
services/llm/providers.py — OpenAI / Gemini / Claude 요청·tool 루프·스트리밍

각 provider의 function-calling 규격에 맞춰 MCP tool을 사용한다.
OpenAI 호환 경로는 첫 SSE에서 tool_call과 일반 답변을 함께 처리해, 도구를
쓰지 않는 대화도 한 번의 호출로 바로 스트리밍한다. 도구 결과가 생긴 경우에만
결과를 재주입해 다음 SSE 라운드를 연다.

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
from .context_window import calculate_output_token_limit
from .tools import (
    build_approval_rejection_instruction, build_tool_directive,
    to_openai_tools, to_gemini_tools, to_claude_tools,
)
from services.runtime_settings import get_runtime_settings
from services.tool_approval import await_tool_approval


def _accumulate_llm_timing(usage: dict | None, timings: dict | None) -> None:
    """Add one OpenAI-compatible call's model time to the request total."""
    if usage is None or not isinstance(timings, dict):
        return
    prompt_duration = _milliseconds_to_nanoseconds(timings.get("prompt_ms"))
    eval_duration = _milliseconds_to_nanoseconds(timings.get("predicted_ms"))
    call_duration = sum(
        duration for duration in (prompt_duration, eval_duration)
        if duration is not None
    )
    if call_duration:
        usage["llm_total_duration"] = usage.get("llm_total_duration", 0) + call_duration


async def _local_max_tokens(
        messages: list[dict], provider_config: dict, tools: list[dict] | None = None,
) -> int:
    """Fit local output inside the model's shared input/output KV cache."""
    runtime = get_runtime_settings()
    from .token_counter import count_local_message_tokens
    input_tokens = await count_local_message_tokens(
        messages, provider_config, tools, runtime["history_chars_per_token"],
    )
    return calculate_output_token_limit(
        messages,
        int(provider_config.get("context_size") or 32768),
        runtime["history_chars_per_token"],
        runtime["llm_num_predict"],
        input_tokens=input_tokens,
    )


def _apply_local_reasoning_control(
    body: dict, provider_config: dict, reasoning: bool | None,
) -> None:
    """Pass the UI reasoning choice using the selected local runtime's API."""
    if not provider_config.get("is_local"):
        return
    if provider_config.get("runtime") == "mlx":
        body["enable_thinking"] = bool(reasoning)
    else:
        body["chat_template_kwargs"] = {"enable_thinking": bool(reasoning)}


def _apply_local_prefix_cache_control(body: dict, provider_config: dict) -> None:
    """Explicitly retain llama.cpp's common-prefix KV cache between requests."""
    if provider_config.get("is_local") and provider_config.get("runtime") == "gguf":
        body["cache_prompt"] = True


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

    # ── 통합 스트리밍 tool 루프 ──
    # tool 판단과 일반 답변을 별도 요청으로 나누면, tool을 쓰지 않는 경우에도
    # 첫 응답을 버린 뒤 다시 생성하게 된다. 첫 streaming 요청에서 tool_calls와
    # 본문을 함께 받으면 일반 대화는 한 번의 호출로 끝나고, tool 결과는 messages의
    # 끝에 추가돼 다음 라운드에서 local runtime의 prefix cache를 그대로 재사용한다.
    approval_rejected = False
    completed_tool_names: set[str] = set()
    tool_sources_found = False
    emitted_text = False
    last_round_had_tools = False
    if unified:
        oa_tools = to_openai_tools(unified)
        for _round in range(TOOL_CALL_MAX_ROUNDS):
            body = {"model": model, "temperature": temperature,
                    "stream": True, "messages": messages, "tools": oa_tools}
            if provider_config.get("is_local"):
                body["max_tokens"] = await _local_max_tokens(messages, provider_config, unified)
                _apply_local_reasoning_control(body, provider_config, reasoning)
                _apply_local_prefix_cache_control(body, provider_config)
            if usage is not None:
                body["stream_options"] = {"include_usage": True}
            log_llm_call(call_reason, "openai", model, streaming=True, reasoning=reasoning,
                         is_tool_judgment=True, round_no=_round)
            tool_calls_by_index: dict[int, dict] = {}
            async with client.stream("POST", base_url, headers=headers, json=body) as resp:
                resp.raise_for_status()
                async for line in resp.aiter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    raw = line[len("data:"):].strip()
                    if raw == "[DONE]":
                        break
                    try:
                        chunk = json.loads(raw)
                    except json.JSONDecodeError:
                        continue
                    if usage is not None:
                        u = chunk.get("usage")
                        if u:
                            usage["prompt_tokens"] = u.get("prompt_tokens")
                            usage["completion_tokens"] = u.get("completion_tokens")
                        _accumulate_llm_timing(usage, chunk.get("timings"))
                    choices = chunk.get("choices") or []
                    if not choices:
                        continue
                    delta = choices[0].get("delta", {}) or {}
                    piece = delta.get("content")
                    if piece:
                        emitted_text = True
                        yield piece
                    for tc_delta in delta.get("tool_calls") or []:
                        index = tc_delta.get("index", 0)
                        tool_call = tool_calls_by_index.setdefault(index, {
                            "id": "", "type": "function",
                            "function": {"name": "", "arguments": ""},
                        })
                        if tc_delta.get("id"):
                            tool_call["id"] = tc_delta["id"]
                        function_delta = tc_delta.get("function") or {}
                        if function_delta.get("name"):
                            tool_call["function"]["name"] = function_delta["name"]
                        if function_delta.get("arguments"):
                            tool_call["function"]["arguments"] += function_delta["arguments"]
            tool_calls = [tool_calls_by_index[index] for index in sorted(tool_calls_by_index)]
            if not tool_calls:
                last_round_had_tools = False
                break
            last_round_had_tools = True
            # 일부 provider가 tool call 전에 짧은 문장을 stream할 수 있다. 그 문장은
            # 최종 답변이 아니므로 클라이언트가 지우고 tool 진행상태를 표시하게 한다.
            if emitted_text:
                await _emit(on_event, {"phase": "reset"})
                emitted_text = False
            # assistant tool_calls 메시지 추가
            messages.append({"role": "assistant",
                             "content": "",
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

    post_tool_docs_applied = False
    if post_tool_docs is not None:
        extra_docs = await post_tool_docs(tool_sources_found, completed_tool_names) or []
        if extra_docs and post_tool_prompt is not None:
            updated_prompt = post_tool_prompt(extra_docs)
            if isinstance(messages[user_message_index].get("content"), list):
                messages[user_message_index]["content"][0] = {"type": "text", "text": updated_prompt}
            else:
                messages[user_message_index]["content"] = updated_prompt
            await _emit(on_event, {"phase": "rag_fallback", "docs": extra_docs})
            post_tool_docs_applied = True
            if emitted_text:
                await _emit(on_event, {"phase": "reset"})
                emitted_text = False

    # tool을 사용한 경우 위 loop의 마지막 streaming 라운드가 이미 최종 답변을
    # 보냈다. 승인 거부와 post-tool RAG 보충 때만 별도 final pass가 필요하다.
    needs_final_stream = (
        not unified or approval_rejected or post_tool_docs_applied or last_round_had_tools
    )
    if not needs_final_stream:
        return

    # ── 최종 답변 스트리밍 ──
    body = {"model": model, "temperature": temperature, "stream": True, "messages": messages}
    if provider_config.get("is_local"):
        runtime = get_runtime_settings()
        body["max_tokens"] = await _local_max_tokens(messages, provider_config, unified)
        _apply_local_reasoning_control(body, provider_config, reasoning)
        _apply_local_prefix_cache_control(body, provider_config)
        if runtime.get("top_p") is not None:
            body["top_p"] = runtime["top_p"]
        if provider_config.get("runtime") == "gguf":
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
    log_llm_call(call_reason, "openai", model, streaming=True, reasoning=reasoning,
                 is_tool_judgment=False if unified else None)
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
                    _accumulate_llm_timing(usage, timings)
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
