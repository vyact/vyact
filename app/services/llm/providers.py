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
    IMAGES_DIR, LLM_TEMPERATURE, LLM_MAX_TOKENS,
    LOCAL_TOOL_CALL_MAX_ROUNDS, CLOUD_TOOL_CALL_MAX_ROUNDS,
    TOOL_CALL_MAX_CONSECUTIVE_FAILURES,
    build_provider_headers, get_provider_config, log_llm_call, log_llm_interaction, log_tool_names, logger,
)
from .helpers import (
    image_attachment_path, load_audio_content_blocks, load_image_data_urls, mime_type,
    history_for_openai, history_for_gemini, history_for_claude,
)
from .context_window import calculate_output_token_limit
from .tools import (
    build_approval_rejection_instruction, build_tool_directive,
    to_openai_tools, to_gemini_tools, to_claude_tools, tool_result_failed,
)
from services.runtime_settings import get_runtime_settings
from services.tool_approval import await_tool_approval
from services.tool_messages import get_tool_language, tool_error, tool_message


_REPEATED_TOOL_CALL_RESULT = (
    "[반복 호출 중단] 같은 도구와 인자가 이미 실행되었습니다. "
    "기존 도구 결과를 사용해 최종 답변을 작성하고, 더 이상 도구를 호출하지 마세요."
)
_REPEATED_TOOL_SKIPPED_RESULT = "[중단] 앞선 도구의 동일 호출이 감지되어 실행하지 않았습니다."
_FAILED_TOOL_SKIPPED_RESULT = "[중단] 앞선 도구 실행이 연속으로 실패하여 실행하지 않았습니다."
_REPEATED_TOOL_FINAL_INSTRUCTION = (
    "\n\n[최우선 — 반복 도구 호출 중단]\n"
    "같은 도구와 인자의 반복 호출이 감지되어 도구 실행을 중단했다. "
    "이미 받은 도구 결과만 사용해 지금 최종 답변을 작성해라. "
    "<tool_call>, <function>, <parameter> 같은 내부 도구 호출 문법을 답변에 출력하지 마라."
)
_FAILED_TOOL_FINAL_INSTRUCTION = (
    "\n\n[최우선 — 연속 도구 실패 중단]\n"
    "도구 실행이 연속으로 실패하여 추가 호출을 중단했다. "
    "실패 원인과 현재까지 확인한 내용을 설명하고, 더 이상 도구를 호출하지 마라."
)
_TOOL_ROUND_LIMIT_FINAL_INSTRUCTION = (
    "\n\n[최우선 — 도구 호출 한도 도달]\n"
    "이번 응답의 도구 호출 라운드 한도에 도달했다. "
    "현재까지의 진행 상황과 남은 작업을 구체적으로 정리하고, 더 이상 도구를 호출하지 마라."
)


def _tool_call_max_rounds(provider_config: dict) -> int:
    """Use a bounded local loop while allowing longer cloud agent runs."""
    return (
        LOCAL_TOOL_CALL_MAX_ROUNDS
        if provider_config.get("is_local")
        else CLOUD_TOOL_CALL_MAX_ROUNDS
    )


def _is_tool_failure(result_text: object) -> bool:
    return tool_result_failed(str(result_text))


def _next_consecutive_tool_failures(current: int, result_text: object) -> int:
    """Count consecutive normalized MCP failures and reset after a success."""
    return current + 1 if _is_tool_failure(result_text) else 0


def _tool_call_fingerprint(name: str, args: object) -> str:
    """Return a stable identity for one tool invocation regardless of key order."""
    try:
        encoded_args = json.dumps(args, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    except (TypeError, ValueError):
        encoded_args = str(args)
    return f"{name}:{encoded_args}"


def _accumulate_llm_timing(usage: dict | None, timings: dict | None) -> None:
    """Accumulate one call's complete server-provided timing breakdown."""
    if usage is None or not isinstance(timings, dict):
        return
    prompt_duration = _milliseconds_to_nanoseconds(timings.get("prompt_ms"))
    eval_duration = _milliseconds_to_nanoseconds(timings.get("predicted_ms"))
    prompt_tokens = timings.get("prompt_n")
    completion_tokens = timings.get("predicted_n")
    cached_tokens = timings.get("cache_n")
    if isinstance(cached_tokens, (int, float)) and cached_tokens >= 0:
        usage["cached_tokens"] = usage.get("cached_tokens", 0) + round(cached_tokens)
    if (
        prompt_duration is None
        or eval_duration is None
        or not isinstance(prompt_tokens, (int, float))
        or not isinstance(completion_tokens, (int, float))
    ):
        return

    usage["_timed_llm_call_count"] = usage.get("_timed_llm_call_count", 0) + 1
    usage["prompt_tokens"] = usage.get("_timing_prompt_tokens", 0) + max(0, round(prompt_tokens))
    usage["completion_tokens"] = usage.get("_timing_completion_tokens", 0) + max(0, round(completion_tokens))
    usage["_timing_prompt_tokens"] = usage["prompt_tokens"]
    usage["_timing_completion_tokens"] = usage["completion_tokens"]
    usage["prompt_eval_duration"] = usage.get("prompt_eval_duration", 0) + prompt_duration
    usage["eval_duration"] = usage.get("eval_duration", 0) + eval_duration
    call_duration = sum(
        duration for duration in (prompt_duration, eval_duration)
        if duration is not None
    )
    if call_duration:
        usage["llm_total_duration"] = usage.get("llm_total_duration", 0) + call_duration

    prompt_seconds = usage["prompt_eval_duration"] / 1_000_000_000
    eval_seconds = usage["eval_duration"] / 1_000_000_000
    usage["prompt_tokens_per_second"] = (
        usage["prompt_tokens"] / prompt_seconds if prompt_seconds > 0 else None
    )
    usage["completion_tokens_per_second"] = (
        usage["completion_tokens"] / eval_seconds if eval_seconds > 0 else None
    )


def _accumulate_openai_usage(usage: dict | None, provider_usage: dict | None) -> None:
    """Normalize standard and oMLX extended usage into Vyact's shared statistics."""
    if usage is None or not isinstance(provider_usage, dict):
        return
    prompt_tokens = provider_usage.get("prompt_tokens")
    completion_tokens = provider_usage.get("completion_tokens")
    prompt_details = (
        provider_usage.get("prompt_tokens_details")
        or provider_usage.get("input_tokens_details")
        or {}
    )
    cached_tokens = prompt_details.get("cached_tokens", provider_usage.get("cached_tokens"))
    if isinstance(cached_tokens, (int, float)):
        usage["cached_tokens"] = usage.get("cached_tokens", 0) + max(0, round(cached_tokens))
        logger.info("[omlx] Memory Cache usage: cached_tokens=%d", max(0, round(cached_tokens)))
    prompt_duration = _seconds_to_nanoseconds(provider_usage.get("prompt_eval_duration"))
    eval_duration = _seconds_to_nanoseconds(provider_usage.get("generation_duration"))
    if prompt_duration is None or eval_duration is None:
        usage["prompt_tokens"] = prompt_tokens
        usage["completion_tokens"] = completion_tokens
        return
    if not isinstance(prompt_tokens, (int, float)) or not isinstance(completion_tokens, (int, float)):
        return

    usage["_timed_llm_call_count"] = usage.get("_timed_llm_call_count", 0) + 1
    usage["prompt_tokens"] = usage.get("_timing_prompt_tokens", 0) + max(0, round(prompt_tokens))
    usage["completion_tokens"] = usage.get("_timing_completion_tokens", 0) + max(0, round(completion_tokens))
    usage["_timing_prompt_tokens"] = usage["prompt_tokens"]
    usage["_timing_completion_tokens"] = usage["completion_tokens"]
    usage["prompt_eval_duration"] = usage.get("prompt_eval_duration", 0) + prompt_duration
    usage["eval_duration"] = usage.get("eval_duration", 0) + eval_duration
    total_duration = _seconds_to_nanoseconds(provider_usage.get("total_time"))
    usage["llm_total_duration"] = usage.get("llm_total_duration", 0) + (
        total_duration if total_duration is not None else prompt_duration + eval_duration
    )
    prompt_seconds = usage["prompt_eval_duration"] / 1_000_000_000
    eval_seconds = usage["eval_duration"] / 1_000_000_000
    usage["prompt_tokens_per_second"] = usage["prompt_tokens"] / prompt_seconds if prompt_seconds > 0 else None
    usage["completion_tokens_per_second"] = usage["completion_tokens"] / eval_seconds if eval_seconds > 0 else None


def _mark_llm_call_started(usage: dict | None) -> None:
    if usage is not None:
        usage["_llm_call_count"] = usage.get("_llm_call_count", 0) + 1


async def _local_max_tokens(
        messages: list[dict], provider_config: dict, tools: list[dict] | None = None,
) -> int:
    """Fit local output inside the model's shared input/output KV cache."""
    runtime = get_runtime_settings()
    from .token_counter import count_local_message_tokens
    input_tokens = await count_local_message_tokens(
        messages, provider_config, tools,
    )
    return calculate_output_token_limit(
        messages,
        int(provider_config.get("context_size") or 32768),
        2.0,
        runtime["llm_num_predict"],
        input_tokens=input_tokens,
    )


async def _apply_local_specprefill_control(
        body: dict, messages: list[dict], provider_config: dict,
        call_reason: str, tools: list[dict] | None = None,
) -> None:
    """Keep SpecPrefill disabled for local MLX requests."""
    if not provider_config.get("is_local") or provider_config.get("runtime") != "mlx":
        return
    body["specprefill"] = False


def _apply_local_reasoning_control(
    body: dict, provider_config: dict, reasoning: bool | str | None,
) -> None:
    """Pass the UI reasoning choice using the selected local runtime's API."""
    if not provider_config.get("is_local"):
        return
    effort = reasoning.lower() if isinstance(reasoning, str) else None
    enabled = effort not in {"none", "off"} if effort is not None else bool(reasoning)
    if provider_config.get("runtime") == "mlx":
        body["chat_template_kwargs"] = {"enable_thinking": enabled}
        if effort and enabled:
            body["reasoning_effort"] = effort
    else:
        body["chat_template_kwargs"] = {"enable_thinking": enabled}
        if effort:
            body["reasoning_effort"] = effort


def _apply_local_prefix_cache_control(body: dict, provider_config: dict) -> None:
    """Explicitly retain llama.cpp's common-prefix KV cache between requests."""
    if provider_config.get("is_local") and provider_config.get("runtime") == "gguf":
        body["cache_prompt"] = True


def _apply_local_seed(body: dict, provider_config: dict) -> None:
    """Apply the selected local model's reproducibility seed per request."""
    if not provider_config.get("is_local"):
        return
    seed = get_runtime_settings().get("seed")
    if seed is not None:
        body["seed"] = int(seed)


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


async def _unoffered_tool_result(name: str) -> str:
    return tool_error(tool_message("not_offered", await get_tool_language(), tool=name))


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
    provider_config = await get_provider_config()
    temperature = provider_config.get("temperature", get_runtime_settings()["llm_temperature"])
    image_urls = load_image_data_urls(attachments)
    audio_blocks = load_audio_content_blocks(attachments)
    if image_urls or audio_blocks:
        content: list = [{"type": "text", "text": user_prompt}]
        for image_url in image_urls:
            content.append({"type": "image_url",
                            "image_url": {"url": image_url}})
        content.extend(audio_blocks)
        user_msg = {"role": "user", "content": content}
    else:
        user_msg = {"role": "user", "content": user_prompt}

    unified, names = await _get_unified_tools(use_tools)
    allowed_tool_names = frozenset(tool["function"]["name"] for tool in unified)
    sys_content = system_message
    if names:
        sys_content = system_message + await build_tool_directive(names)

    messages = [{"role": "system", "content": sys_content},
                *history_for_openai(history_messages, valid_slice), user_msg]
    user_message_index = len(messages) - 1

    headers = build_provider_headers(await get_provider_config())
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
    repeated_tool_call = False
    consecutive_tool_failures = 0
    tool_failures_exhausted = False
    executed_tool_calls: set[str] = set()
    if unified:
        oa_tools = to_openai_tools(unified)
        for _round in range(_tool_call_max_rounds(provider_config)):
            body = {"model": model, "temperature": temperature,
                    "stream": True, "messages": messages, "tools": oa_tools}
            if provider_config.get("is_local"):
                body["max_tokens"] = await _local_max_tokens(messages, provider_config, unified)
                _apply_local_reasoning_control(body, provider_config, reasoning)
                _apply_local_prefix_cache_control(body, provider_config)
                _apply_local_seed(body, provider_config)
                await _apply_local_specprefill_control(
                    body, messages, provider_config, call_reason, oa_tools,
                )
            elif provider_config.get("selection_type") == "openai":
                body["max_completion_tokens"] = provider_config.get("max_output_tokens", 2048)
            if usage is not None:
                body["stream_options"] = {"include_usage": True}
            log_llm_call(call_reason, "openai", model, streaming=True, reasoning=reasoning,
                         is_tool_judgment=True, round_no=_round)
            tool_calls_by_index: dict[int, dict] = {}
            _mark_llm_call_started(usage)
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
                            _accumulate_openai_usage(usage, u)
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
                if name not in allowed_tool_names:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": await _unoffered_tool_result(name),
                    })
                    continue
                raw_args = fn.get("arguments") or "{}"
                try:
                    args = json.loads(raw_args) if isinstance(raw_args, str) else raw_args
                except json.JSONDecodeError:
                    args = {}
                fingerprint = _tool_call_fingerprint(name, args)
                if fingerprint in executed_tool_calls:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": _REPEATED_TOOL_CALL_RESULT,
                    })
                    repeated_tool_call = True
                    continue
                if repeated_tool_call:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": _REPEATED_TOOL_SKIPPED_RESULT,
                    })
                    continue
                if approval_rejected:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다.",
                    })
                    continue
                if tool_failures_exhausted:
                    messages.append({
                        "role": "tool", "tool_call_id": tc.get("id", ""),
                        "content": _FAILED_TOOL_SKIPPED_RESULT,
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
                executed_tool_calls.add(fingerprint)
                result_text = await mcp_manager.call_tool(name, args)
                consecutive_tool_failures = _next_consecutive_tool_failures(
                    consecutive_tool_failures, result_text,
                )
                if consecutive_tool_failures >= TOOL_CALL_MAX_CONSECUTIVE_FAILURES:
                    tool_failures_exhausted = True
                tool_sources = mcp_manager.drain_tool_sources()
                if not _is_tool_failure(result_text):
                    completed_tool_names.add(name)
                tool_sources_found = tool_sources_found or bool(tool_sources)
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                messages.append({"role": "tool", "tool_call_id": tc.get("id", ""),
                                 "content": result_text})
            if approval_rejected or repeated_tool_call or tool_failures_exhausted:
                if repeated_tool_call:
                    messages[0]["content"] += _REPEATED_TOOL_FINAL_INSTRUCTION
                if tool_failures_exhausted:
                    messages[0]["content"] += _FAILED_TOOL_FINAL_INSTRUCTION
                break
        else:
            messages[0]["content"] += _TOOL_ROUND_LIMIT_FINAL_INSTRUCTION

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
        _apply_local_seed(body, provider_config)
        await _apply_local_specprefill_control(
            body, messages, provider_config, call_reason, unified,
        )
        if runtime.get("top_p") is not None:
            body["top_p"] = runtime["top_p"]
        if runtime.get("top_k") is not None:
            body["top_k"] = runtime["top_k"]
        if provider_config.get("runtime") == "gguf":
            if structured_output_schema is not None:
                body["response_format"] = {
                    "type": "json_schema",
                    "json_schema": {"name": "vyact_response", "schema": structured_output_schema},
                }
    elif provider_config.get("selection_type") == "openai":
        body["max_completion_tokens"] = provider_config.get("max_output_tokens", 2048)
    if usage is not None:
        # stream=True에서도 마지막 청크에 usage를 실어 보내도록 요청 (choices는 빈 배열로 옴)
        body["stream_options"] = {"include_usage": True}
    log_llm_call(call_reason, "openai", model, streaming=True, reasoning=reasoning,
                 is_tool_judgment=False if unified else None)
    _mark_llm_call_started(usage)
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
                    _accumulate_openai_usage(usage, u)
                timings = chunk.get("timings")
                if isinstance(timings, dict):
                    _accumulate_llm_timing(usage, timings)
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


def _seconds_to_nanoseconds(value) -> int | None:
    if not isinstance(value, (int, float)):
        return None
    return max(0, round(value * 1_000_000_000))


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
    provider_config = await get_provider_config()
    temperature = provider_config.get("temperature", get_runtime_settings()["llm_temperature"])
    max_output_tokens = provider_config.get("max_output_tokens", 2048)
    unified, names = await _get_unified_tools(use_tools)
    allowed_tool_names = frozenset(tool["function"]["name"] for tool in unified)
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
    gen_cfg = {"temperature": temperature, "maxOutputTokens": max_output_tokens}

    # ── tool 루프 (비스트리밍) ──
    approval_rejected = False
    repeated_tool_call = False
    consecutive_tool_failures = 0
    tool_failures_exhausted = False
    tool_round_limit_reached = False
    executed_tool_calls: set[str] = set()
    if unified:
        gm_tools = to_gemini_tools(unified)
        for _round in range(_tool_call_max_rounds(provider_config)):
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
                if name not in allowed_tool_names:
                    resp_parts.append({"functionResponse": {
                        "name": name, "response": {"result": await _unoffered_tool_result(name)},
                    }})
                    continue
                args = fc.get("args", {}) or {}
                fingerprint = _tool_call_fingerprint(name, args)
                if fingerprint in executed_tool_calls:
                    resp_parts.append({"functionResponse": {
                        "name": name, "response": {"result": _REPEATED_TOOL_CALL_RESULT},
                    }})
                    repeated_tool_call = True
                    continue
                if repeated_tool_call:
                    resp_parts.append({"functionResponse": {
                        "name": name,
                        "response": {"result": _REPEATED_TOOL_SKIPPED_RESULT},
                    }})
                    continue
                if approval_rejected:
                    resp_parts.append({"functionResponse": {
                        "name": name,
                        "response": {"result": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다."},
                    }})
                    continue
                if tool_failures_exhausted:
                    resp_parts.append({"functionResponse": {
                        "name": name,
                        "response": {"result": _FAILED_TOOL_SKIPPED_RESULT},
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
                executed_tool_calls.add(fingerprint)
                result_text = await mcp_manager.call_tool(name, args)
                consecutive_tool_failures = _next_consecutive_tool_failures(
                    consecutive_tool_failures, result_text,
                )
                if consecutive_tool_failures >= TOOL_CALL_MAX_CONSECUTIVE_FAILURES:
                    tool_failures_exhausted = True
                tool_sources = mcp_manager.drain_tool_sources()
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                resp_parts.append({"functionResponse": {
                    "name": name, "response": {"result": result_text}}})
            contents.append({"role": "user", "parts": resp_parts})
            if approval_rejected or repeated_tool_call or tool_failures_exhausted:
                if repeated_tool_call:
                    sys_text += _REPEATED_TOOL_FINAL_INSTRUCTION
                if tool_failures_exhausted:
                    sys_text += _FAILED_TOOL_FINAL_INSTRUCTION
                break
        else:
            tool_round_limit_reached = True
            sys_text += _TOOL_ROUND_LIMIT_FINAL_INSTRUCTION

    # ── 최종 답변 스트리밍 ──
    body = {
        "systemInstruction": {"parts": [{"text": sys_text}]},
        "contents": contents,
        "generationConfig": gen_cfg,
    }
    if (
        unified
        and not approval_rejected
        and not repeated_tool_call
        and not tool_failures_exhausted
        and not tool_round_limit_reached
    ):
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
    provider_config = await get_provider_config()
    temperature = provider_config.get("temperature", runtime["llm_temperature"])
    max_tokens = provider_config.get("max_output_tokens", runtime["llm_max_tokens"])
    blocks: list = [{"type": "text", "text": user_prompt}]
    for att in attachments:
        if att.get("type") == "image":
            path = image_attachment_path(att)
            if path.exists():
                blocks.append({"type": "image", "source": {
                    "type": "base64", "media_type": mime_type(att["filename"]),
                    "data": base64.b64encode(path.read_bytes()).decode()}})

    unified, names = await _get_unified_tools(use_tools)
    allowed_tool_names = frozenset(tool["function"]["name"] for tool in unified)
    system_text = system_message
    if names:
        system_text = system_message + await build_tool_directive(names)

    messages = [*history_for_claude(history_messages, valid_slice),
                {"role": "user", "content": blocks}]

    headers = {"x-api-key": api_key, "anthropic-version": "2023-06-01"}
    base_url = "https://api.anthropic.com/v1/messages"

    # ── tool 루프 (비스트리밍) ──
    approval_rejected = False
    repeated_tool_call = False
    consecutive_tool_failures = 0
    tool_failures_exhausted = False
    tool_round_limit_reached = False
    executed_tool_calls: set[str] = set()
    if unified:
        cl_tools = to_claude_tools(unified)
        for _round in range(_tool_call_max_rounds(provider_config)):
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
                if name not in allowed_tool_names:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": await _unoffered_tool_result(name), "is_error": True,
                    })
                    continue
                args = tu.get("input", {}) or {}
                fingerprint = _tool_call_fingerprint(name, args)
                if fingerprint in executed_tool_calls:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": _REPEATED_TOOL_CALL_RESULT,
                    })
                    repeated_tool_call = True
                    continue
                if repeated_tool_call:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": _REPEATED_TOOL_SKIPPED_RESULT,
                    })
                    continue
                if approval_rejected:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": "[취소] 같은 응답의 앞선 도구 실행을 사용자가 거부하여 실행하지 않았습니다.",
                    })
                    continue
                if tool_failures_exhausted:
                    result_blocks.append({
                        "type": "tool_result", "tool_use_id": tu.get("id", ""),
                        "content": _FAILED_TOOL_SKIPPED_RESULT,
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
                executed_tool_calls.add(fingerprint)
                result_text = await mcp_manager.call_tool(name, args)
                consecutive_tool_failures = _next_consecutive_tool_failures(
                    consecutive_tool_failures, result_text,
                )
                if consecutive_tool_failures >= TOOL_CALL_MAX_CONSECUTIVE_FAILURES:
                    tool_failures_exhausted = True
                tool_sources = mcp_manager.drain_tool_sources()
                await _emit(on_event, {"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                result_blocks.append({"type": "tool_result",
                                      "tool_use_id": tu.get("id", ""),
                                      "content": result_text})
            messages.append({"role": "user", "content": result_blocks})
            if approval_rejected or repeated_tool_call or tool_failures_exhausted:
                if repeated_tool_call:
                    system_text += _REPEATED_TOOL_FINAL_INSTRUCTION
                if tool_failures_exhausted:
                    system_text += _FAILED_TOOL_FINAL_INSTRUCTION
                break
        else:
            tool_round_limit_reached = True
            system_text += _TOOL_ROUND_LIMIT_FINAL_INSTRUCTION

    # ── 최종 답변 스트리밍 ──
    body = {"model": model, "max_tokens": max_tokens, "temperature": temperature,
            "system": system_text, "stream": True, "messages": messages}
    if (
        unified
        and not approval_rejected
        and not repeated_tool_call
        and not tool_failures_exhausted
        and not tool_round_limit_reached
    ):
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
