"""
services/mcp_client.py — MCP(Model Context Protocol) 클라이언트 매니저

여러 MCP 서버(stdio)를 앱 생명주기 동안 연결 유지하고,
- 전체 tool 목록을 Ollama tool schema로 변환해서 제공 (get_ollama_tools)
- LLM이 요청한 tool_call을 해당 서버로 라우팅해 실행 (call_tool)
한다.

tool 이름 충돌 방지를 위해 "<서버명>__<tool명>" 형태로 prefix를 붙인다.
LLM에는 prefixed 이름을 노출하고, 실행 시 prefix를 벗겨 원래 서버/tool로 라우팅한다.

NOTE: LLM이 tool을 "직접 실행"하지 않는다. LLM은 tool_calls만 반환하고,
      백엔드(agent.py의 tool 루프)가 이 매니저를 통해 실제 실행 후 결과를 재주입한다.
"""
from __future__ import annotations

import asyncio
from contextvars import ContextVar
from contextlib import AsyncExitStack
from typing import Any

from logger import get_logger

logger = get_logger(__name__)

# tool 이름 prefix 구분자 (서버명과 tool명 사이)
_SEP = "__"
_request_server_ids: ContextVar[frozenset[str] | None] = ContextVar("request_mcp_server_ids", default=None)
_request_server_types: ContextVar[frozenset[str] | None] = ContextVar("request_mcp_server_types", default=None)


class _Server:
    """단일 MCP 서버 연결 상태(연결 성공 후 세션/tool 보관)."""

    def __init__(self, name: str, session: Any, tools: list[Any]):
        self.name = name
        self.session = session
        self.tools = tools  # mcp.types.Tool 리스트


def _cfg_key(cfg: dict) -> str:
    """서버 config의 동등성 판단용 키. command/args/env/whitelist가 같으면 동일 연결로 본다."""
    import json
    try:
        return json.dumps({
            "command": cfg.get("command"),
            "args": cfg.get("args", []),
            "env": cfg.get("env", {}),
            "url": cfg.get("url"),
            "transport": cfg.get("transport"),
            "tool_whitelist": cfg.get("tool_whitelist"),
        }, sort_keys=True, ensure_ascii=False)
    except Exception:
        return repr(cfg)


class _ServerWorker:
    """MCP 서버 하나를 담당하는 개별 워커.

    자기 전용 task 안에서만 stdio stack을 열고 닫는다(anyio 취소 스코프 안전).
    목표 상태(desired)를 들고 있으며, 연결 도중 desired가 바뀌면 수립 완료 후
    즉시 목표에 맞게 정리한다(on 도중 off가 오면 붙였다가 바로 뗀다).
    """

    def __init__(self, name: str, cfg: dict):
        self.name = name
        self.cfg = cfg
        self.cfg_key = _cfg_key(cfg)
        self.server: _Server | None = None      # 연결 성공 시 채워짐
        self._task: asyncio.Task | None = None
        self._stop = asyncio.Event()            # 종료 요청 신호
        self._ready = asyncio.Event()           # 최초 연결 시도 완료(성공/실패 무관) 신호

    def start(self) -> None:
        self._task = asyncio.create_task(self._run(), name=f"mcp-{self.name}")

    async def _run(self) -> None:
        from mcp import ClientSession, StdioServerParameters
        from mcp.client.stdio import stdio_client

        cfg = self.cfg
        transport_kind = cfg.get("transport", "stdio")  # "stdio" | "sse" | "streamable_http"
        try:
            if transport_kind == "stdio":
                command = cfg.get("command")
                if not command:
                    logger.warning("[mcp] '%s' missing command — skipping", self.name)
                    return
                params = StdioServerParameters(
                    command=command,
                    args=cfg.get("args", []),
                    env=cfg.get("env") or None,
                )

            url = cfg.get("url", "")
            if transport_kind in ("sse", "streamable_http") and not url:
                logger.warning("[mcp] '%s' missing url — skipping", self.name)
                return

            async with AsyncExitStack() as stack:
                try:
                    if transport_kind == "sse":
                        from mcp.client.sse import sse_client
                        headers = cfg.get("headers") or {}
                        read, write = await stack.enter_async_context(
                            sse_client(url, headers=headers or None)
                        )
                    elif transport_kind == "streamable_http":
                        from mcp.client.streamable_http import streamablehttp_client
                        headers = cfg.get("headers") or {}
                        read, write, _ = await stack.enter_async_context(
                            streamablehttp_client(url, headers=headers or None)
                        )
                    else:
                        read, write = await stack.enter_async_context(stdio_client(params))

                    session = await stack.enter_async_context(ClientSession(read, write))
                    await session.initialize()
                    resp = await session.list_tools()
                    tools = resp.tools
                    whitelist = cfg.get("tool_whitelist")
                    if whitelist:
                        allowed = set(whitelist)
                        tools = [t for t in tools if t.name in allowed]
                    self.server = _Server(self.name, session, tools)
                    logger.info("[mcp] '%s' connected (%s) — %d tools%s: %s",
                                self.name, transport_kind, len(tools),
                                f" ({len(resp.tools)} total, whitelisted)" if whitelist else "",
                                [t.name for t in tools])

                    # 인증 프로브: 연결 직후 경량 tool을 호출해 OAuth 등 인증을 선제 트리거
                    auth_probe = cfg.get("auth_probe")
                    if auth_probe:
                        try:
                            await session.call_tool(auth_probe, {})
                            logger.info("[mcp] '%s' auth probe succeeded (%s)", self.name, auth_probe)
                        except Exception as e:
                            logger.warning("[mcp] '%s' auth probe failed (%s): %s — "
                                           "disabling server",
                                           self.name, auth_probe, e)
                            # 인증 실패 → 서버 비활성화 (UI에 반영)
                            try:
                                from services.mcp_config import disable_server_by_type
                                await disable_server_by_type(cfg.get("_server_type", ""))
                            except Exception:
                                pass
                            self.server = None
                            self._ready.set()
                            return
                except Exception as e:
                    logger.warning("[mcp] '%s' connection failed: %s", self.name, e)
                    self.server = None
                    self._ready.set()
                    return

                self._ready.set()
                await self._stop.wait()
        except asyncio.CancelledError:
            # task가 직접 취소된 경우에도 async with가 stack을 이 task에서 정리한다.
            logger.debug("[mcp] '%s' worker cancelled", self.name)
        except Exception as e:
            logger.warning("[mcp] '%s' worker error: %s", self.name, e)
        finally:
            self.server = None
            self._ready.set()

    async def wait_ready(self) -> None:
        await self._ready.wait()

    async def stop(self) -> None:
        """이 서버를 정리한다. stack은 워커 자신의 task에서 닫힌다."""
        self._stop.set()
        if self._task is not None:
            try:
                await self._task
            except asyncio.CancelledError:
                pass
            except Exception as e:
                logger.debug("[mcp] '%s' shutdown wait error (ignored): %s", self.name, e)


class MCPManager:
    """MCP 서버들을 연결/유지하고 tool 조회·실행을 중개.

    서버마다 개별 워커(_ServerWorker)를 두어, 스위치 토글 시 바뀐 서버만
    증분으로 붙이거나 뗀다. 전체 재연결을 하지 않는다.
    """

    def __init__(self) -> None:
        self._workers: dict[str, _ServerWorker] = {}
        self._sync_lock = asyncio.Lock()
        # 내부 tool: 외부 MCP 서버 없이 파이썬 함수를 tool로 직접 노출.
        self._internal_tools: dict[str, dict] = {}
        # tool 실행 결과에 딸려온 sources(기사 등)를 임시 보관 — call_tool 직후
        # drain_tool_sources()로 꺼내 "참고" 표시용으로 상위(agent.py 등)에 전달한다.
        self._pending_sources: list[dict] = []
        # Google Workspace 인증 상태 캐시 (get_ollama_tools에서 참조)
        self._google_authenticated: bool = False

    def drain_tool_sources(self) -> list[dict]:
        """직전 call_tool 실행에서 쌓인 sources를 꺼내고 비운다."""
        out = self._pending_sources
        self._pending_sources = []
        return out

    async def enable_request_scope(self, server_ids: list[str]):
        from services.mcp_config import build_servers_config, list_servers
        requested_ids = set(server_ids)
        selected = [server for server in await list_servers() if server.get("id") in requested_ids]
        if not selected:
            return None
        selected_ids = {server["id"] for server in selected}
        await self.connect_all(await build_servers_config(selected_ids))
        return (_request_server_ids.set(frozenset(selected_ids)), _request_server_types.set(frozenset(server.get("type") for server in selected)))

    def reset_request_scope(self, tokens) -> None:
        if tokens is not None:
            _request_server_ids.reset(tokens[0])
            _request_server_types.reset(tokens[1])

    def has_request_scope(self) -> bool:
        """현재 요청이 @로 MCP 하나를 명시 선택했는지 반환한다."""
        return _request_server_ids.get() is not None

    def get_request_scope_server_ids(self) -> set[str] | None:
        """@로 선택한 MCP 서버 ID 집합. 일반 요청이면 None."""
        selected_ids = _request_server_ids.get()
        return set(selected_ids) if selected_ids is not None else None

    async def refresh_google_auth(self) -> bool:
        """Google Workspace 인증 상태를 갱신하고 결과를 반환한다."""
        try:
            from services.google_workspace import check_auth_status
            self._google_authenticated = await check_auth_status()
        except Exception:
            self._google_authenticated = False
        return self._google_authenticated

    @property
    def connected(self) -> bool:
        # 내부 tool만 있어도 "사용 가능" 상태로 본다.
        return bool(self._internal_tools) or any(w.server for w in self._workers.values())

    def register_internal_tool(self, name: str, description: str,
                               parameters: dict, handler,
                               server_type: str | None = None,
                               single_shot: bool = False) -> None:
        """외부 프로세스 없이 파이썬 함수를 tool로 등록한다.

        name: tool 이름 (prefix 없이. 내부 tool은 그대로 노출)
        parameters: JSON Schema (function.parameters)
        handler: async def handler(**kwargs) -> str | dict
                 문자열만 반환하면 그대로 tool 결과 텍스트가 된다.
                 {"text": "...", "sources": [{"title","url","source","indexed_at"}, ...]}
                 형태의 dict를 반환하면, text는 tool 결과로 LLM에 전달되고
                 sources는 drain_tool_sources()로 꺼내 "참고" 목록에 붙일 수 있다.
        server_type: 이 tool이 속한 MCP 서버 타입(예: "naver_news").
                     지정 시 해당 타입 서버가 enabled일 때만 노출된다.
                     None이면 항상 노출.
        single_shot: True면 이 tool이 한 번이라도 호출된 라운드에서 곧바로
                     tool 판정 루프를 끝낸다(더 이상 LLM에게 "tool 더 쓸지"를
                     되묻지 않는다). 검색 결과를 그대로 최종 답변에 반영하면
                     충분한 tool(예: 웹/뉴스 검색)에 적합하다.
        """
        self._internal_tools[name] = {
            "description": description,
            "parameters": parameters or {"type": "object", "properties": {}},
            "handler": handler,
            "server_type": server_type,
            "single_shot": single_shot,
        }
        logger.info("[mcp] Internal tool registered: %s (type=%s, single_shot=%s)", name, server_type, single_shot)

    def unregister_internal_tools_by_type(self, server_type: str) -> int:
        """특정 server_type의 내부 tool을 모두 제거한다. 제거된 개수 반환."""
        to_remove = [n for n, s in self._internal_tools.items() if s.get("server_type") == server_type]
        for n in to_remove:
            del self._internal_tools[n]
        if to_remove:
            logger.info("[mcp] %d internal tools removed (type=%s)", len(to_remove), server_type)
        return len(to_remove)

    def is_single_shot(self, prefixed_name: str) -> bool:
        """이 tool 이름이 single_shot으로 등록됐는지 확인 (외부 MCP tool은 항상 False)."""
        spec = self._internal_tools.get(prefixed_name)
        return bool(spec and spec.get("single_shot"))

    async def connect_all(self, servers_config: dict[str, dict]) -> None:
        """주어진 config를 '목표 상태'로 삼아 현재 연결을 수렴시킨다.

        - config에 있고 아직 연결 안 된(또는 config가 바뀐) 서버 → 새 워커 시작
        - config에서 사라진(또는 config가 바뀐) 서버 → 기존 워커 종료
        - 동일한 서버 → 그대로 유지 (재연결 안 함)

        전체를 sync_lock으로 직렬화하므로, on 도중 off를 눌러도(또는 반대로)
        마지막에 호출된 목표 config로 안전하게 수렴한다.
        """
        desired = servers_config or {}
        async with self._sync_lock:
            # 1) 제거/변경 대상 워커 종료
            to_stop: list[str] = []
            for name, worker in self._workers.items():
                new_cfg = desired.get(name)
                if new_cfg is None or _cfg_key(new_cfg) != worker.cfg_key:
                    to_stop.append(name)
            for name in to_stop:
                worker = self._workers.pop(name)
                await worker.stop()
                logger.info("[mcp] '%s' disconnected", name)

            # 2) 추가/변경 대상 워커 시작
            for name, cfg in desired.items():
                if name in self._workers:
                    continue  # 이미 동일 config로 연결 유지 중
                worker = _ServerWorker(name, cfg)
                self._workers[name] = worker
                worker.start()

            # 3) 새로 시작한 워커들의 최초 연결 시도 완료를 기다린다
            #    (get_ollama_tools가 곧바로 정확한 tool 목록을 반환하도록)
            for worker in list(self._workers.values()):
                try:
                    await asyncio.wait_for(worker.wait_ready(), timeout=30.0)
                except asyncio.TimeoutError:
                    logger.warning("[mcp] '%s' connection wait timeout (continuing in background)", worker.name)

    async def get_ollama_tools(self) -> list[dict]:
        """연결된 모든 서버의 tool을 Ollama /api/chat 'tools' 스키마로 변환.

        내부 tool은 server_type이 지정된 경우 해당 타입 서버가 enabled일 때만 노출한다.
        """
        selected_server_ids = _request_server_ids.get()
        selected_server_types = _request_server_types.get()
        enabled_types: set[str] = set()
        enabled_server_ids: set[str] = set()
        try:
            from services.mcp_config import list_servers
            for s in await list_servers():
                if s.get("enabled") or (selected_server_ids and s.get("id") in selected_server_ids):
                    enabled_types.add(s.get("type"))
                    if s.get("id"):
                        enabled_server_ids.add(s["id"])
        except Exception as e:
            # 예전엔 조회 실패 시 "내부 tool 전체 노출"로 fail-open 했는데, 그러면 사용자가
            # MCP를 전부 꺼도 이 예외 한 번으로 모든 내부 tool이 다시 노출되어 불필요한
            # tool 판정 LLM 호출이 발생한다. 있으나 마나 한 tool 노출보다는 이번 턴에
            # tool 없이 넘어가는 쪽이 안전하므로 fail-closed로 바꾼다.
            logger.warning("[mcp] failed to query enabled types, hiding all internal tools (fail-closed): %s", e)
            enabled_types = set()

        # 코드 폴더가 설정되어 있으면 code_tools 타입을 enabled에 추가
        try:
            from services.code_tools import current_code_folder
            if current_code_folder.get():
                enabled_types.add("code_tools")
        except Exception:
            pass

        out: list[dict] = []
        for worker in self._workers.values():
            srv = worker.server
            if srv is None:
                continue
            worker_server_id = worker.cfg.get("_server_id")
            # 연결 해제는 background task라 OFF 직후 기존 worker가 잠시 남을 수 있다.
            # 실제 LLM 노출 시점에는 영속 설정을 다시 확인해 fail-closed로 차단한다.
            if worker_server_id not in enabled_server_ids:
                continue
            for t in srv.tools:
                schema = getattr(t, "inputSchema", None) or {"type": "object", "properties": {}}
                out.append({
                    "type": "function",
                    "function": {
                        "name": f"{srv.name}{_SEP}{t.name}",
                        "description": t.description or "",
                        "parameters": schema,
                    },
                })
        for name, spec in self._internal_tools.items():
            stype = spec.get("server_type")
            if selected_server_ids and stype not in (selected_server_types or frozenset()):
                continue
            if stype is not None and stype not in enabled_types:
                continue
            # google_workspace: 인증 안 됐으면 tool 노출 안 함
            if stype == "google_workspace" and not self._google_authenticated:
                continue
            out.append({
                "type": "function",
                "function": {
                    "name": name,
                    "description": spec["description"],
                    "parameters": spec["parameters"],
                },
            })
        exposed_names = [tool["function"]["name"] for tool in out]
        logger.info(
            "[mcp] LLM tool exposure: count=%d enabled_types=%s selected_ids=%s tools=%s",
            len(out), sorted(value for value in enabled_types if value),
            sorted(selected_server_ids) if selected_server_ids else [], exposed_names,
        )
        return out

    def has_tools(self) -> bool:
        """등록된 tool이 하나라도 있는지의 '가능성'만 보는 빠른 사전 체크.
        실제로 지금 이 순간 노출 가능한(enabled) tool이 있는지는 비동기 조회가 필요해서
        여기선 판단하지 않는다 — 호출부가 이 체크 통과 후 반드시 get_ollama_tools()로
        최종 필터링한다. 그래서 '모든 MCP를 껐는데도 tool 판정 호출이 발생하는' 문제의
        진짜 원인은 여기가 아니라 get_ollama_tools()의 enabled 조회 실패 시 폴백 로직에 있다
        (아래 참고).
        """
        return bool(self._internal_tools) or any(
            w.server and w.server.tools for w in self._workers.values()
        )

    async def call_tool(self, prefixed_name: str, arguments: dict | None) -> str:
        """tool 이름을 라우팅해 실행하고 결과를 텍스트로 반환.

        내부 tool 핸들러가 {"text":..., "sources":[...]} 형태의 dict를 반환하면
        sources는 self._pending_sources에 적재하고(drain_tool_sources로 소비),
        text만 결과 텍스트로 반환한다.
        """
        spec = self._internal_tools.get(prefixed_name)
        if spec is not None:
            try:
                result = await spec["handler"](**(arguments or {}))
                if isinstance(result, dict):
                    srcs = result.get("sources") or []
                    if srcs:
                        self._pending_sources.extend(srcs)
                    return str(result.get("text", "") or "")
                return result if isinstance(result, str) else str(result)
            except Exception as e:
                logger.warning("[mcp] internal tool failed %s: %s", prefixed_name, e)
                return f"[오류] tool 실행 실패({prefixed_name}): {e}"

        if _SEP not in prefixed_name:
            return f"[오류] 잘못된 tool 이름: {prefixed_name}"
        server_name, tool_name = prefixed_name.split(_SEP, 1)
        worker = self._workers.get(server_name)
        if not worker or worker.server is None:
            return f"[오류] 알 수 없는 MCP 서버: {server_name}"

        try:
            result = await worker.server.session.call_tool(tool_name, arguments or {})
        except Exception as e:
            logger.warning("[mcp] call_tool failed %s: %s", prefixed_name, e)
            return f"[오류] tool 실행 실패({prefixed_name}): {e}"

        return self._result_to_text(result)

    @staticmethod
    def _result_to_text(result: Any) -> str:
        """CallToolResult.content(블록 리스트)를 사람이/LLM이 읽을 텍스트로 평탄화."""
        parts: list[str] = []
        for block in getattr(result, "content", []) or []:
            btype = getattr(block, "type", None)
            if btype == "text":
                parts.append(getattr(block, "text", ""))
            elif btype == "image":
                parts.append("[이미지 결과]")
            else:
                txt = getattr(block, "text", None)
                parts.append(txt if txt is not None else str(block))
        text = "\n".join(p for p in parts if p).strip()
        if getattr(result, "isError", False):
            return f"[tool 오류] {text or '알 수 없는 오류'}"
        return text or "(결과 없음)"

    async def close(self) -> None:
        """모든 서버 워커를 정리한다. 각 stack은 자기 워커 task에서 닫힌다."""
        async with self._sync_lock:
            workers = list(self._workers.values())
            self._workers.clear()
            for worker in workers:
                await worker.stop()


# 앱 전역 싱글턴
mcp_manager = MCPManager()
