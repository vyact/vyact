"""
services/llm/ollama.py — Ollama 요청 조립 + MCP tool 왕복 루프
"""
import asyncio
import hashlib
import json

import httpx

from logger import DebugLogSettings
from prompts import build_system_message, build_user_prompt
from .config import (
    OLLAMA_URL, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_TEMPERATURE, TOP_K, TOP_P, OLLAMA_KEEP_ALIVE,
    LLM_STOP_TOKENS, TOOL_CALL_MAX_ROUNDS,
    TOOL_CALL_DECISION_NUM_PREDICT, TOOL_CALL_MUTATION_NUM_PREDICT,
    TOOL_CALL_ROUND_TIMEOUT_SECONDS, TOOL_CALL_RETRY_RESULT_CHARS,
    get_provider_config, log_llm_call, log_tool_names, logger,
)
from .helpers import load_images_b64, history_for_ollama
from .tools import build_approval_rejection_instruction, build_tool_directive
from services.runtime_settings import get_runtime_settings
from services.tool_approval import await_tool_approval, get_tool_rejection_response
from .context_window import select_context_allocation


_CODE_CONTEXT_TOOL_NAMES = {
    "code_list_directory", "code_read_file", "code_read_files",
    "code_find_files", "code_grep_search",
}
_CODE_MUTATION_TOOL_NAMES = {
    "code_edit_file", "code_apply_patch", "code_create_file",
    "code_move_file", "code_delete_file",
}
_BROWSER_STATE_CHANGING_TOOL_NAMES = {
    "browser_open", "browser_click", "browser_type", "browser_scroll", "browser_back",
}
_BROWSER_OBSERVATION_TOOL_NAMES = {"browser_read", "browser_inspect", "browser_status"}


def _last_tool_call(messages: list[dict]) -> tuple[str, bool]:
    for message_index in range(len(messages) - 1, -1, -1):
        message = messages[message_index]
        if message.get("role") != "assistant" or not message.get("tool_calls"):
            continue
        function = message["tool_calls"][-1].get("function", {}) or {}
        name = function.get("name", "")
        following_messages = messages[message_index + 1:]
        failed = any(
            item.get("role") == "tool" and str(item.get("content", "")).startswith("[오류]")
            for item in following_messages
        )
        return name, failed
    return "", False


def _tool_decision_num_predict(messages: list[dict]) -> int:
    last_tool_name, last_tool_failed = _last_tool_call(messages)
    if last_tool_name in _CODE_CONTEXT_TOOL_NAMES:
        return TOOL_CALL_MUTATION_NUM_PREDICT
    if last_tool_failed and last_tool_name in _CODE_MUTATION_TOOL_NAMES:
        return TOOL_CALL_MUTATION_NUM_PREDICT
    return TOOL_CALL_DECISION_NUM_PREDICT


def _compact_tool_results(messages: list[dict]) -> list[dict]:
    compacted: list[dict] = []
    half_limit = TOOL_CALL_RETRY_RESULT_CHARS // 2
    for message in messages:
        content = message.get("content")
        if message.get("role") != "tool" or not isinstance(content, str) or len(content) <= TOOL_CALL_RETRY_RESULT_CHARS:
            compacted.append(message)
            continue
        compacted.append({
            **message,
            "content": (
                content[:half_limit]
                + "\n\n[tool result shortened after timeout; use a targeted read for omitted lines]\n\n"
                + content[-half_limit:]
            ),
        })
    return compacted


def _failure_call_key(name: str, args: dict, exact_call_key: str) -> str:
    """Group retries that target the same edit even when replacement text changes."""
    if name != "code_edit_file":
        return exact_call_key
    old_string = str(args.get("old_string", ""))
    first_content_line = next((line.strip() for line in old_string.splitlines() if line.strip()), "")
    target = {
        "folder_id": args.get("folder_id"),
        "path": args.get("path"),
        "old_anchor": " ".join(first_content_line.split()),
    }
    canonical_target = json.dumps(target, ensure_ascii=False, sort_keys=True, default=str)
    return f"{name}:{hashlib.md5(canonical_target.encode()).hexdigest()[:8]}"


def _tool_result_failed(result_text: str) -> bool:
    if result_text.startswith("[오류]"):
        return True
    if not result_text.lstrip().startswith("{"):
        return False
    try:
        payload = json.loads(result_text)
    except json.JSONDecodeError:
        return False
    return isinstance(payload, dict) and (
        payload.get("ok") is False or bool(payload.get("error"))
    )


async def build_ollama_payload(
        question: str,
        context_docs: list[dict],
        system_prompt: str,
        attachments: list,
        conversation_history: list,
        format_instruction_override: str | None,
        inject_user_profile: bool,
        conversation_summary: str = "",
        reasoning: bool = True,
        include_skills: bool = True,
        isolated_system_prompt: bool = False,
) -> tuple[str, dict]:
    """Ollama 스트리밍/논스트리밍 공용 — model 이름과 /api/chat 요청 body를 조립.

    reasoning=False 이면 gemma 등의 thinking(추론) 단계를 끈다(think:false).
    번역처럼 추론이 불필요한 단발 작업의 응답 속도를 높인다.
    """
    provider_config = await get_provider_config()
    runtime = get_runtime_settings()
    model = provider_config["model"]

    from .helpers import select_history_by_budget
    valid_slice = select_history_by_budget(conversation_history)
    history_messages = []
    for m in valid_slice:
        if m["role"] == "tool":
            history_messages.append({
                "role": "tool",
                "name": m.get("tool_name") or m.get("name", ""),
                "content": m["content"],
            })
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

    images_b64 = load_images_b64(attachments)
    user_msg: dict = {"role": "user", "content": user_prompt}
    if images_b64:
        user_msg["images"] = images_b64

    messages = [
        {"role": "system", "content": system_message},
        *history_for_ollama(history_messages, valid_slice),
        user_msg,
    ]
    context_window, output_limit = select_context_allocation(
        messages, runtime["llm_num_ctx"], runtime["history_chars_per_token"],
        runtime["llm_num_predict"],
    )
    body = {
        "model": model,
        "stream": True,
        "keep_alive": runtime["ollama_keep_alive"],
        "messages": messages,
        "options": {
            "num_ctx": context_window,
            "num_predict": output_limit,
            "temperature": runtime["llm_temperature"],
            **({"top_k": runtime["top_k"]} if runtime["top_k"] else {}),
            **({"top_p": runtime["top_p"]} if runtime["top_p"] else {})
        },
    }
    if not reasoning:
        body["think"] = False
    return model, body


async def resolve_tool_calls(model: str, messages: list, options: dict,
                             timeout: float, max_rounds: int = TOOL_CALL_MAX_ROUNDS,
                             on_event=None, call_reason: str = "unspecified",
                             reasoning: bool = True) -> dict:
    """LLM ↔ MCP tool 왕복으로 tool_calls를 모두 풀어낸다 (Ollama).

    모든 판정 라운드는 stream:false (blocking)로 실행한다. tool 사용 여부를
    먼저 확정한 뒤 호출부(core.py)에서 최종 답변만 스트리밍한다.

    on_event: tool 진행 상태를 프론트에 전달하는 콜백.
      - {"phase": "judging", "round": N}: 판정 라운드 시작
      - {"phase": "start/end", "name": ...}: tool 호출 시작/종료

    반환값: {"messages": list, "direct_answer": str|None, "stats": dict|None}
    - direct_answer: tool 미사용 시 판정 호출의 답변 (재생성 생략 가능).
    - stats: 합산된 통계.
    """
    from services.mcp_client import mcp_manager

    async def _emit(ev: dict):
        if on_event is not None:
            try:
                await on_event(ev)
            except Exception:
                pass

    def _extract_stats(data: dict) -> dict | None:
        if data.get("prompt_eval_count") is None and data.get("eval_count") is None:
            return None
        return {
            "load_duration": data.get("load_duration"),
            "prompt_eval_count": data.get("prompt_eval_count"),
            "prompt_eval_duration": data.get("prompt_eval_duration"),
            "eval_count": data.get("eval_count"),
            "eval_duration": data.get("eval_duration"),
            "total_duration": data.get("total_duration"),
        }

    tools: list[dict] = []

    def _result(msgs: list, direct_answer: str | None = None, stats: dict | None = None) -> dict:
        # The final response request must retain the identical tool schema. Ollama's
        # chat template places it near the front of the prompt, so dropping it after
        # a tool round invalidates the otherwise reusable prefix cache.
        return {"messages": msgs, "direct_answer": direct_answer, "stats": stats, "tools": tools}

    if not mcp_manager.connected or not mcp_manager.has_tools():
        return _result(messages)

    tools = await mcp_manager.get_ollama_tools()
    if not tools:
        return _result(messages)
    work = list(messages)

    tool_names = [t["function"]["name"] for t in tools]
    await log_tool_names(tool_names, reason=call_reason)
    tool_directive = await build_tool_directive(tool_names)

    injected = False
    for i, m in enumerate(work):
        if m.get("role") == "system":
            work[i] = {**m, "content": (m.get("content", "") or "") + tool_directive}
            injected = True
            break
    if not injected:
        work.insert(0, {"role": "system", "content": tool_directive.strip()})

    async def _run_round_blocking(client: httpx.AsyncClient, body: dict) -> dict:
        """비스트리밍 판정 라운드."""
        body = {**body, "stream": False}
        started_at = _time.monotonic()
        tool_count = len(body.get("tools") or [])
        logger.info(
            "[tool_calls] Ollama 판정 요청 시작: model=%s messages=%d tools=%d",
            body.get("model"), len(body.get("messages") or []), tool_count,
        )

        async def _log_waiting() -> None:
            while True:
                await asyncio.sleep(10)
                logger.info(
                    "[tool_calls] Ollama 판정 응답 대기 중: elapsed=%.1fs model=%s tools=%d",
                    _time.monotonic() - started_at, body.get("model"), tool_count,
                )

        waiting_log_task = asyncio.create_task(_log_waiting())
        try:
            resp = await client.post(
                f"{OLLAMA_URL}/api/chat",
                headers={"Content-Type": "application/json"}, json=body,
            )
        finally:
            waiting_log_task.cancel()
            try:
                await waiting_log_task
            except asyncio.CancelledError:
                pass
        logger.info(
            "[tool_calls] Ollama 판정 응답 완료: elapsed=%.1fs status=%d",
            _time.monotonic() - started_at, resp.status_code,
        )
        resp.raise_for_status()
        data = resp.json()
        msg = data.get("message", {}) or {}
        return {"tool_calls": msg.get("tool_calls") or [],
                "content": msg.get("content", "") or "",
                "thinking": msg.get("thinking", "") or "",
                "stats": _extract_stats(data), "committed": False, "aborted": False}

    # ── 멀티라운드 stats 합산용 ──
    import time as _time
    _acc_stats = {
        "load_duration": 0,
        "prompt_eval_count": 0, "prompt_eval_duration": 0,
        "eval_count": 0, "eval_duration": 0,
        "total_duration": 0,  # LLM 호출 시간 합산
        "tool_duration": 0,   # tool 실행 시간 합산 (ns)
        "tool_call_count": 0, # tool 호출 횟수
        "llm_rounds": 0,
    }

    def _accumulate_stats(round_stats: dict | None):
        if not round_stats:
            return
        _acc_stats["llm_rounds"] += 1
        for k in ("load_duration", "prompt_eval_count", "prompt_eval_duration", "eval_count", "eval_duration", "total_duration"):
            v = round_stats.get(k)
            if v is not None:
                _acc_stats[k] += v

    def _build_merged_stats(last_round_stats: dict | None) -> dict | None:
        """마지막 라운드 stats에 합산 정보를 추가하여 반환."""
        _accumulate_stats(last_round_stats)
        if _acc_stats["llm_rounds"] == 0 and not last_round_stats:
            return None
        base = dict(last_round_stats) if last_round_stats else {}
        # 합산 필드 추가
        base["llm_total_duration"] = _acc_stats["total_duration"]  # LLM 전체 소요 (ns)
        base["tool_duration"] = _acc_stats["tool_duration"]        # tool 전체 소요 (ns)
        base["tool_call_count"] = _acc_stats["tool_call_count"]
        base["llm_rounds"] = _acc_stats["llm_rounds"]
        return base

    # ── 연속 실패/중복 호출 감지 ──
    _fail_tracker: dict[str, int] = {}  # "tool_name:args_hash" → 연속 실패 횟수
    _call_count: dict[str, int] = {}    # 동일 호출 총 횟수 (성공 포함)
    _last_successful_call: tuple[str, str] | None = None  # 직전 성공 호출과 결과
    _debug_execution_ledger: list[dict] = []
    _MAX_SAME_FAIL = 2   # 같은 호출이 2회 실패하면 중단
    _MAX_SAME_CALL = 3   # 같은 호출이 3회 이상이면 중단 (성공 포함)
    rejection_answer: str | None = None

    runtime = get_runtime_settings()
    async with httpx.AsyncClient(timeout=timeout) as client:
        for _round in range(max_rounds):
            DebugLogSettings.log(
                "tool_round_start",
                provider="ollama",
                round=_round + 1,
                message_count=len(work),
                previous_tool=_last_tool_call(work)[0] or None,
                executed_tool_count=len(_debug_execution_ledger),
            )
            logger.info("[tool_calls] 판정 라운드 시작: round=%d/%d", _round + 1, max_rounds)
            await _emit({"phase": "judging", "round": _round})
            decision_options = {
                **options,
                "num_predict": _tool_decision_num_predict(work),
            }
            body = {"model": model, "messages": work,
                    "tools": tools, "options": decision_options, "keep_alive": runtime["ollama_keep_alive"]}
            if not reasoning:
                body["think"] = False
            try:
                round_result = await asyncio.wait_for(
                    _run_round_blocking(client, body),
                    timeout=min(timeout, TOOL_CALL_ROUND_TIMEOUT_SECONDS),
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "[tool_calls] 판정 라운드 timeout(%ds), 축약 문맥으로 1회 재시도: round=%d",
                    TOOL_CALL_ROUND_TIMEOUT_SECONDS, _round + 1,
                )
                retry_body = {**body, "messages": _compact_tool_results(work)}
                try:
                    round_result = await asyncio.wait_for(
                        _run_round_blocking(client, retry_body),
                        timeout=min(timeout, TOOL_CALL_ROUND_TIMEOUT_SECONDS),
                    )
                except asyncio.TimeoutError:
                    logger.error(
                        "[tool_calls] 축약 문맥 재시도도 timeout(%ds): round=%d",
                        TOOL_CALL_ROUND_TIMEOUT_SECONDS, _round + 1,
                    )
                    timeout_instruction = {
                        "role": "system",
                        "content": (
                            "The tool-decision request timed out twice. Do not claim that pending work was completed. "
                            "Explain that execution stopped because the local model did not return the next tool call in time."
                        ),
                    }
                    return _result([*work, timeout_instruction], stats=_build_merged_stats(None))
                except Exception as retry_error:
                    logger.warning("[tool_calls] 축약 문맥 재시도 실패: %s", retry_error)
                    return _result(work)
            except Exception as e:
                logger.warning("[tool_calls] 호출 실패, tool 없이 진행: %s", e)
                return _result(work)

            tool_calls = round_result["tool_calls"]
            content = round_result["content"]

            # 라운드별 tool 판정은 llm_*.log(순수 LLM 요청/응답 전용)가 아니라
            # 앱 로그(app_*.log)에 남긴다 — tool 왕복은 LLM API 호출이긴 하지만
            # 오케스트레이션 내부 동작이라 llm 로그와는 성격이 다르다고 봄.
            # 호출 이유/streaming 여부 + tool_calls 요약을 한 줄로 합쳐서 남긴다.
            tc_summary = [
                {"name": (tc.get("function", {}) or {}).get("name"),
                 "arguments": (tc.get("function", {}) or {}).get("arguments")}
                for tc in tool_calls
            ]
            DebugLogSettings.log(
                "llm_tool_decision",
                provider="ollama",
                round=_round + 1,
                previous_tool=_last_tool_call(work)[0] or None,
                decision_text=content,
                reasoning=round_result.get("thinking") or None,
                tool_calls=[{
                    "name": item.get("name"),
                    "arguments": DebugLogSettings.redact_arguments(item.get("arguments") or {}),
                } for item in tc_summary],
            )
            log_llm_call(
                call_reason, "ollama", model, streaming=False,
                reasoning=reasoning,
                is_tool_judgment=True, round_no=_round,
                extra=f"tool_calls={tc_summary or '없음(종료)'} content_len={len(content)}",
            )

            if not tool_calls:
                visited_urls = []
                clicks = []
                user_waits = []
                for execution in _debug_execution_ledger:
                    summary = execution.get("summary") or {}
                    url = summary.get("url")
                    if url and url not in visited_urls:
                        visited_urls.append(url)
                    for page in summary.get("pages") or []:
                        page_url = page.get("url")
                        if page_url and page_url not in visited_urls:
                            visited_urls.append(page_url)
                    if execution.get("tool") == "browser_click":
                        clicks.append(summary.get("element") or execution.get("arguments"))
                    if execution.get("tool") in {"browser_ask_user", "browser_wait_for_user"}:
                        user_waits.append(execution.get("tool"))
                DebugLogSettings.log(
                    "tool_flow_completion_audit",
                    round=_round + 1,
                    executed_tool_count=len(_debug_execution_ledger),
                    tool_counts={name: sum(1 for item in _debug_execution_ledger if item["tool"] == name)
                                 for name in {item["tool"] for item in _debug_execution_ledger}},
                    visited_url_count=len(visited_urls),
                    visited_urls=visited_urls,
                    click_count=len(clicks),
                    clicked_elements=clicks,
                    user_wait_calls=user_waits,
                    final_decision_text=content,
                )
                DebugLogSettings.log(
                    "tool_flow_stopped",
                    round=_round + 1,
                    previous_tool=_last_tool_call(work)[0] or None,
                    reason="model_returned_no_tool_calls",
                    decision_text=content,
                    reasoning=round_result.get("thinking") or None,
                )
                final_messages = work if len(work) > len(messages) else messages
                merged = _build_merged_stats(round_result["stats"])
                return _result(final_messages, direct_answer=content or None,
                               stats=merged)

            # 이번 라운드(tool 호출이 있는 중간 라운드)의 LLM stats 누적
            _accumulate_stats(round_result["stats"])

            work.append({"role": "assistant", "content": content, "tool_calls": tool_calls})

            hit_single_shot = False
            _should_break = False
            for tc in tool_calls:
                fn = tc.get("function", {}) or {}
                name = fn.get("name", "")
                args = fn.get("arguments", {}) or {}
                # 동일 호출 중복 감지
                canonical_args = json.dumps(args, ensure_ascii=False, sort_keys=True, default=str)
                _call_key = f"{name}:{hashlib.md5(canonical_args.encode()).hexdigest()[:8]}"
                _fail_key = _failure_call_key(name, args, _call_key)
                _call_count[_call_key] = _call_count.get(_call_key, 0) + 1
                if _last_successful_call and _last_successful_call[0] == _call_key:
                    logger.info("[tool_calls] 동일 호출 결과 재사용 — 실행 생략: %s args=%s", name, args)
                    work.append({
                        "role": "tool",
                        "tool_name": name,
                        "content": _last_successful_call[1]
                                   + "\n\n[안내] 동일한 인자의 이전 실행 결과를 재사용했습니다. "
                                     "같은 호출을 반복하지 말고 다음 단계로 진행하세요.",
                    })
                    if _call_count[_call_key] >= _MAX_SAME_CALL:
                        logger.warning("[tool_calls] 동일 호출 %d회 요청 — 현재 결과로 종료: %s", _call_count[_call_key], name)
                        _should_break = True
                        break
                    continue
                if _call_count[_call_key] > _MAX_SAME_CALL:
                    logger.warning("[tool_calls] 동일 호출 %d회 반복 — 스킵: %s", _call_count[_call_key], name)
                    work.append({
                        "role": "tool", "tool_name": name,
                        "content": f"[중단] 같은 tool 호출이 {_call_count[_call_key]}회 반복되었습니다. "
                                   f"이전 결과를 활용하세요. 더 이상 같은 호출을 하지 마세요.",
                    })
                    _should_break = True
                    break

                # 다른 호출이 하나라도 끼면 이후 동일 인자 호출은 재검증/재읽기일 수 있다.
                _last_successful_call = None
                logger.info("[tool_calls] tool 호출: %s args=%s", name, args)
                approved = await await_tool_approval(name, args, _emit)
                if not approved:
                    result_text = "[사용자 거부] 사용자가 이 tool 실행을 승인하지 않았습니다. 실행하지 말고 다른 안전한 방법을 사용하거나 거부 사실을 설명하세요."
                    await _emit({"phase": "approval_rejected", "name": name, "args": args, "result": result_text})
                    work.append({"role": "tool", "content": result_text, "tool_name": name})
                    work.append({
                        "role": "system",
                        "content": build_approval_rejection_instruction(name).strip(),
                    })
                    rejection_answer = await get_tool_rejection_response(name)
                    _should_break = True
                    break
                await _emit({"phase": "start", "name": name, "args": args})
                _t0 = _time.monotonic_ns()
                result_text = await mcp_manager.call_tool(name, args)
                _acc_stats["tool_duration"] += _time.monotonic_ns() - _t0
                _acc_stats["tool_call_count"] += 1
                tool_sources = mcp_manager.drain_tool_sources()
                await _emit({"phase": "end", "name": name, "args": args, "result": result_text, "sources": tool_sources})
                work.append({"role": "tool", "content": result_text, "tool_name": name})
                _debug_execution_ledger.append({
                    "round": _round + 1,
                    "tool": name,
                    "arguments": DebugLogSettings.redact_arguments(args),
                    "summary": DebugLogSettings.summarize_result(result_text),
                })
                DebugLogSettings.log(
                    "tool_result_added_to_context",
                    round=_round + 1,
                    tool=name,
                    result_chars=len(result_text),
                    summary=DebugLogSettings.summarize_result(result_text),
                )
                if mcp_manager.is_single_shot(name):
                    hit_single_shot = True

                # 연속 실패 감지 — tool 결과가 에러이면 카운트
                is_error = _tool_result_failed(result_text)
                if is_error:
                    _fail_tracker[_fail_key] = _fail_tracker.get(_fail_key, 0) + 1
                    if _fail_tracker[_fail_key] >= _MAX_SAME_FAIL:
                        logger.warning(
                            "[tool_calls] 같은 호출 %d회 연속 실패 — 조기 중단: %s",
                            _fail_tracker[_fail_key], name,
                        )
                        work.append({
                            "role": "tool", "tool_name": name,
                            "content": f"[중단] 같은 tool 호출이 {_fail_tracker[_fail_key]}회 연속 실패했습니다. "
                                       f"더 이상 재시도하지 말고 사용자에게 실패 원인을 설명하세요.",
                        })
                        _should_break = True
                        break
                else:
                    _fail_tracker.pop(_fail_key, None)
                    _last_successful_call = (_call_key, result_text)
                    if name in _BROWSER_STATE_CHANGING_TOOL_NAMES:
                        # Empty-argument observations refer to the current page, not the whole
                        # tool flow. A navigation or DOM mutation starts a fresh observation scope.
                        for call_key in list(_call_count):
                            if call_key.split(":", 1)[0] in _BROWSER_OBSERVATION_TOOL_NAMES:
                                _call_count.pop(call_key, None)

            if _should_break:
                # 조기 중단 — 현재 문맥으로 최종 응답 생성
                logger.info(
                    "[tool_calls] %s — 현재 문맥으로 응답",
                    "사용자 승인 거부로 종료" if rejection_answer else "반복/연속 실패로 조기 중단",
                )
                return _result(
                    work,
                    direct_answer=rejection_answer,
                    stats=_build_merged_stats(None),
                )

            if hit_single_shot:
                logger.info("[tool_calls] single_shot tool 호출 완료 — 재판정 없이 종료")
                return _result(work, stats=_build_merged_stats(None))

        logger.warning("[tool_calls] 최대 라운드(%d) 도달 — 현재 문맥으로 응답", max_rounds)
        return _result(work, stats=_build_merged_stats(None))
