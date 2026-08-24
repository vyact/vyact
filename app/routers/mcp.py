"""
routers/mcp.py — MCP 서버 설정 API

GET    /api/mcp/catalog          → 타입 카탈로그(프리셋) — UI가 폼 렌더에 사용
GET    /api/mcp/servers          → 등록된 서버 목록
POST   /api/mcp/servers          → 서버 추가 {type, config, enabled}
PATCH  /api/mcp/servers/{id}     → 서버 수정 {config?, enabled?}
DELETE /api/mcp/servers/{id}     → 서버 삭제
GET    /api/mcp/status           → 연결 상태 + 활성 tool 목록

변경 시 외부 MCP 서버를 재연결한다.
"""
import asyncio

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse
from pydantic import BaseModel

from services.mcp_config import (
    MCP_CATALOG, list_servers, add_server, update_server, remove_server,
    build_servers_config,
)
from services.mcp_client import mcp_manager
from logger import get_logger

logger = get_logger(__name__)
router = APIRouter()


class AddServerReq(BaseModel):
    type: str
    config: dict = {}
    enabled: bool = True
    prompt: str = ""


class UpdateServerReq(BaseModel):
    config: dict | None = None
    enabled: bool | None = None
    prompt: str | None = None


_reconnect_lock = asyncio.Lock()
_reconnect_pending = False   # 처리 대기 중인 재sync 요청이 있는지
_reconnect_running = False   # 러너가 현재 도는 중인지


async def _sync_once():
    """항상 최신 DB 상태를 읽어 목표 config로 수렴시킨다."""
    try:
        # Google Workspace tool을 scope 기반으로 재등록
        try:
            from services.google_workspace import register_google_workspace_tools, get_granted_scopes
            granted = await get_granted_scopes()
            mcp_manager.unregister_internal_tools_by_type("google_workspace")
            register_google_workspace_tools(mcp_manager, granted_scopes=granted)
        except Exception as e:
            logger.debug("[mcp] Google tool 재등록 실패: %s", e)
        await mcp_manager.connect_all(await build_servers_config())
        try:
            await mcp_manager.refresh_google_auth()
        except Exception:
            pass
        try:
            from services.mcp_config import get_github_username
            await get_github_username()
        except Exception as e:
            logger.debug("[mcp] github username prefetch 실패: %s", e)
    except asyncio.CancelledError as e:
        logger.debug("[mcp] 재연결 취소 (무해): %s", e)
    except Exception as e:
        logger.warning("[mcp] 재연결 실패: %s", e)


async def _do_reconnect():
    """재연결 러너 (coalescing).

    여러 토글이 짧게 겹쳐 들어와도 러너는 하나만 돈다. 러너는 매 반복마다
    '최신 DB 상태'를 읽어 sync하므로, on→off를 완료 전에 연타해도
    마지막 DB 상태(OFF)로 정확히 수렴한다. 러너가 도는 동안 새 요청이 오면
    pending 플래그만 세워 한 번 더 돌게 한다(낡은 중간 상태는 건너뛴다).
    """
    global _reconnect_pending, _reconnect_running
    _reconnect_pending = True
    if _reconnect_running:
        # 이미 러너가 돌고 있으면 플래그만 세우고 반환 — 러너가 최신 상태로 처리한다.
        return
    _reconnect_running = True
    try:
        while _reconnect_pending:
            _reconnect_pending = False
            async with _reconnect_lock:
                await _sync_once()
    finally:
        _reconnect_running = False


_bg_tasks: set = set()


def _reconnect_bg():
    """재연결을 백그라운드로 실행 — API 응답을 막지 않는다.
    (외부 MCP 서버 재spawn은 수 초 걸릴 수 있어 요청을 블로킹하면 UI가 멈춘다.)"""
    task = asyncio.create_task(_do_reconnect())
    # 태스크 참조를 유지해 GC로 사라지지 않게 하고, 완료 시 제거한다.
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)


def _request_notification_poll() -> None:
    from services.notification_polling import request_notification_poll
    request_notification_poll()


def _mask(servers: list[dict]) -> list[dict]:
    """secret 필드는 값 대신 설정 여부만 노출."""
    out = []
    for s in servers:
        cat = MCP_CATALOG.get(s.get("type"), {})
        secret_keys = {f["key"] for f in cat.get("fields", []) if f["type"] == "secret"}
        conf = dict(s.get("config") or {})
        for k in secret_keys:
            if conf.get(k):
                conf[k] = "********"
        # 내부 전용/파생 필드는 프론트에 노출하지 않음 (_로 시작하는 것 + username)
        conf = {k: v for k, v in conf.items() if not k.startswith("_") and k != "username"}
        out.append({**s, "config": conf})
    return out


@router.get("/mcp/catalog")
async def get_catalog():
    return {"catalog": MCP_CATALOG}


@router.get("/mcp/servers")
async def get_servers():
    return {"servers": _mask(await list_servers())}


@router.post("/mcp/servers")
async def create_server(req: AddServerReq):
    try:
        server = await add_server(req.type, req.config, req.enabled, req.prompt)
    except ValueError as e:
        raise HTTPException(400, str(e))
    _reconnect_bg()
    if req.type == "google_workspace":
        _request_notification_poll()
    return {"server": _mask([server])[0]}


@router.patch("/mcp/servers/{server_id}")
async def patch_server(server_id: str, req: UpdateServerReq):
    existing = next((s for s in await list_servers() if s.get("id") == server_id), None)
    config = req.config
    if config is not None:
        # 마스킹된 secret(********)이 그대로 오면 기존 값 유지
        if existing:
            cat = MCP_CATALOG.get(existing.get("type"), {})
            secret_keys = {f["key"] for f in cat.get("fields", []) if f["type"] == "secret"}
            old_conf = existing.get("config") or {}
            for k in secret_keys:
                if config.get(k) == "********":
                    config[k] = old_conf.get(k, "")
        # username은 저장하지 않는다 — 토큰 기준으로 필요 시 자동 재조회한다.
        # (토큰이 바뀌었을 수 있으므로 옛 username을 남기지 않는다)
        config.pop("username", None)
    servers = await update_server(server_id, config=config, enabled=req.enabled, prompt=req.prompt)
    _reconnect_bg()
    if existing and existing.get("type") == "google_workspace":
        _request_notification_poll()
    return {"servers": _mask(servers)}


@router.delete("/mcp/servers/{server_id}")
async def delete_server(server_id: str):
    existing = next((s for s in await list_servers() if s.get("id") == server_id), None)
    if existing and existing.get("type") == "google_workspace":
        from services.google_workspace import revoke_all_tokens
        await revoke_all_tokens()
    servers = await remove_server(server_id)
    _reconnect_bg()
    if existing and existing.get("type") == "google_workspace":
        _request_notification_poll()
    return {"servers": _mask(servers)}


@router.get("/mcp/status")
async def mcp_status():
    return {
        "connected": mcp_manager.connected,
        "tools": [t["function"]["name"] for t in await mcp_manager.get_tools()],
    }


# ── Google Workspace OAuth ───────────────────────────────────────────


class GoogleAuthReq(BaseModel):
    account_id: str
    gauth_json: str | dict


@router.post("/mcp/google/auth-url")
async def google_auth_url(req: GoogleAuthReq):
    """OAuth2 인증 URL을 생성해 반환한다."""
    try:
        from services.google_workspace import start_oauth_flow
        url = await start_oauth_flow(req.account_id, req.gauth_json)
        return {"auth_url": url}
    except Exception as e:
        raise HTTPException(400, f"OAuth URL 생성 실패: {e}")


@router.get("/mcp/google/oauth-redirect")
async def google_oauth_redirect(request: Request):
    """Google OAuth 리다이렉트 콜백 — 코드를 받아 토큰 교환 후 완료 페이지를 표시한다."""
    code = request.query_params.get("code")
    state = request.query_params.get("state")
    error = request.query_params.get("error")

    if error:
        return HTMLResponse(_oauth_result_html(False, f"인증 거부됨: {error}"))
    if not code or not state:
        return HTMLResponse(_oauth_result_html(False, "인증 코드 또는 상태값이 없습니다."))

    try:
        from services.google_workspace import exchange_oauth_code
        await exchange_oauth_code(code, state)
        await mcp_manager.refresh_google_auth()
        _reconnect_bg()  # scope 기반으로 tool 재등록
        _request_notification_poll()
        return HTMLResponse(_oauth_result_html(True, "Google 계정이 연결되었습니다."))
    except Exception as e:
        logger.warning("[mcp] Google OAuth 콜백 실패: %s", e)
        return HTMLResponse(_oauth_result_html(False, f"토큰 교환 실패: {e}"))


def _oauth_result_html(success: bool, message: str) -> str:
    color = "#4caf50" if success else "#e5484d"
    icon = "✓" if success else "✕"
    return f"""<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Google 인증</title>
<style>
  body {{ background: #1e1e1e; color: #e0e0e0; font-family: -apple-system, sans-serif;
         display: flex; align-items: center; justify-content: center; height: 100vh; margin: 0; }}
  .box {{ text-align: center; }}
  .icon {{ font-size: 64px; color: {color}; }}
  .msg {{ font-size: 18px; margin: 16px 0; }}
  .sub {{ font-size: 14px; color: #888; }}
</style></head>
<body><div class="box">
  <div class="icon">{icon}</div>
  <div class="msg">{message}</div>
  <div class="sub">이 창을 닫아도 됩니다.</div>
</div>
<script>setTimeout(() => window.close(), 2000);</script>
</body></html>"""


@router.get("/mcp/google/auth-status")
async def google_auth_status():
    """현재 Google 인증 상태를 확인한다."""
    from services.google_workspace import get_auth_status
    status = await get_auth_status()
    mcp_manager._google_authenticated = status["authenticated"]
    return status


@router.get("/mcp/google/accounts/{account_id}/auth-status")
async def google_account_auth_status(account_id: str):
    from services.google_workspace import check_auth_status
    return {"authenticated": await check_auth_status(account_id)}


@router.post("/mcp/google/accounts/{account_id}/activate")
async def google_account_activate(account_id: str):
    server = next(
        (
            item for item in await list_servers()
            if item.get("type") == "google_workspace"
        ),
        None,
    )
    if not server:
        raise HTTPException(404, "Google Workspace 설정을 찾을 수 없습니다.")
    config = dict(server.get("config") or {})
    accounts = config.get("accounts", [])
    if not any(account.get("id") == account_id for account in accounts):
        raise HTTPException(404, "Google 계정을 찾을 수 없습니다.")
    from services.google_workspace import check_auth_status
    if not await check_auth_status(account_id):
        raise HTTPException(409, "선택한 Google 계정의 재연결이 필요합니다.")
    config["active_account_id"] = account_id
    await update_server(server["id"], config=config)
    await mcp_manager.refresh_google_auth()
    _reconnect_bg()
    _request_notification_poll()
    return {"ok": True, "active_account_id": account_id}


@router.post("/mcp/google/accounts/{account_id}/disconnect")
async def google_disconnect(account_id: str):
    """Google OAuth 토큰을 삭제한다 (연결 해제)."""
    from services.google_workspace import get_auth_status, revoke_token
    await revoke_token(account_id)
    status = await get_auth_status()
    mcp_manager._google_authenticated = status["authenticated"]
    _request_notification_poll()
    return {"ok": True}
