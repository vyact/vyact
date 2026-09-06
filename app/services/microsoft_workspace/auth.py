"""Desktop OAuth with PKCE; tokens stay in the integration credential store."""
import asyncio
import base64
import hashlib
import secrets
import time
import uuid
from contextlib import AsyncExitStack
from urllib.parse import urlencode

import httpx
from elasticsearch import NotFoundError
from fastapi import HTTPException

from logger import get_logger

from services.db import INTEGRATION_CREDENTIALS_INDEX, get_es
from services.mcp_config import list_servers
from services.microsoft_workspace import request_limits as limits
from services.microsoft_workspace.transport import managed_request

AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0"
GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite"
logger = get_logger(__name__)
_pending: dict[str, dict] = {}
_locks: dict[str, asyncio.Lock] = {}
_generations: dict[str, int] = {}


async def config() -> dict:
    server = next((s for s in await list_servers() if s.get("type") == "microsoft_workspace"), {})
    return server.get("config") or {}


async def account(account_id: str = "") -> tuple[dict, dict]:
    settings = await config()
    account_id = account_id or settings.get("active_account_id", "")
    item = next((a for a in settings.get("accounts", []) if a.get("id") == account_id), None)
    if not item:
        raise HTTPException(401, "microsoft.accountUnavailable")
    return settings, item


async def read_token(account_id: str) -> dict:
    es = get_es()
    try:
        doc = await es.get(index=INTEGRATION_CREDENTIALS_INDEX, id=f"microsoft_token_{account_id}")
        return doc.get("_source", {}).get("value", {})
    except NotFoundError:
        return {}
    finally:
        await es.close()


async def save_token(account_id: str, value: dict) -> None:
    es = get_es()
    try:
        key = f"microsoft_token_{account_id}"
        await es.index(index=INTEGRATION_CREDENTIALS_INDEX, id=key,
                       document={"key": key, "value": value}, refresh=True)
    finally:
        await es.close()


async def disconnect(account_id: str) -> None:
    _generations[account_id] = _generations.get(account_id, 0) + 1
    for state, pending in list(_pending.items()):
        if pending["account_id"] == account_id:
            _pending.pop(state, None)
    async with _locks.setdefault(account_id, asyncio.Lock()):
        await save_token(account_id, {})


async def revoke_all_tokens() -> None:
    """Clear Microsoft credentials and invalidate pending OAuth callbacks on restore."""
    for account_id in set(_generations) | set(_locks) | {pending["account_id"] for pending in _pending.values()}:
        _generations[account_id] = _generations.get(account_id, 0) + 1
    _pending.clear()
    async with AsyncExitStack() as stack:
        # Wait for in-flight refreshes before deleting credentials they may have saved.
        for account_id in sorted(_locks):
            await stack.enter_async_context(_locks[account_id])
        es = get_es()
        try:
            await es.delete_by_query(
                index=INTEGRATION_CREDENTIALS_INDEX,
                query={"prefix": {"key": "microsoft_token_"}},
                conflicts="proceed",
                refresh=True,
            )
        finally:
            await es.close()


async def status() -> dict:
    settings = await config()
    accounts = []
    for item in settings.get("accounts", []):
        token = await read_token(item["id"])
        connected = bool(token.get("refresh_token") and token.get("client_id") == settings.get("client_id"))
        accounts.append({"id": item["id"], "email": token.get("email", ""),
                         "authenticated": connected, "reconnect_required": not connected})
    return {"accounts": accounts, "authenticated": any(a["authenticated"] for a in accounts),
            "config": settings}


async def start_login(account_id: str, redirect_uri: str) -> str:
    settings, _ = await account(account_id)
    try:
        client_id = str(uuid.UUID(settings.get("client_id", "")))
    except (ValueError, TypeError, AttributeError):
        raise HTTPException(400, "microsoft.invalidClientId") from None
    now = time.time()
    for key, pending in list(_pending.items()):
        if pending["expires_at"] < now:
            _pending.pop(key, None)
    state, verifier = secrets.token_urlsafe(32), secrets.token_urlsafe(64)
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    _pending[state] = {"account_id": account_id, "client_id": client_id, "verifier": verifier,
                       "redirect_uri": redirect_uri, "expires_at": now + 600, "generation": _generations.setdefault(account_id, 0)}
    return f"{AUTHORITY}/authorize?{urlencode({'client_id': client_id, 'response_type': 'code', 'redirect_uri': redirect_uri, 'scope': SCOPES, 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'})}"


async def complete_login(state: str, code: str) -> None:
    pending = _pending.pop(state, None)
    if not pending or pending["expires_at"] < time.time():
        raise HTTPException(400, "microsoft.loginExpired")
    settings, _ = await account(pending["account_id"])
    if settings.get("client_id") != pending["client_id"]:
        raise HTTPException(400, "microsoft.loginExpired")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await managed_request(client, scope_for_token(settings["client_id"], {}, pending["account_id"], "oauth"), "POST", f"{AUTHORITY}/token", data={
            "client_id": pending["client_id"], "grant_type": "authorization_code", "code": code,
            "redirect_uri": pending["redirect_uri"], "code_verifier": pending["verifier"], "scope": SCOPES,
        })
        if response.is_error:
            raise HTTPException(401, "microsoft.connectFailed")
        token = response.json()
        profile = await managed_request(client, scope_for_token(settings["client_id"], {}, pending["account_id"], "profile"), "GET", f"{GRAPH_ROOT}/me", headers={"Authorization": f"Bearer {token['access_token']}"})
        if profile.is_error:
            raise HTTPException(401, "microsoft.connectFailed")
    # A disconnected/deleted account must not be resurrected by an in-flight login.
    current, _ = await account(pending["account_id"])
    if current.get("client_id") != pending["client_id"]:
        raise HTTPException(400, "microsoft.loginExpired")
    if not token.get("refresh_token"):
        raise HTTPException(401, "microsoft.connectFailed")
    token.update(client_id=pending["client_id"], expires_at=time.time() + token.get("expires_in", 3600),
                 mailbox_id=profile.json().get("id", ""),
                 email=profile.json().get("mail") or profile.json().get("userPrincipalName", ""))
    async with _locks.setdefault(pending["account_id"], asyncio.Lock()):
        if pending["generation"] != _generations.get(pending["account_id"], 0):
            raise HTTPException(400, "microsoft.loginExpired")
        await save_token(pending["account_id"], token)


async def access_token(account_id: str = "") -> tuple[str, dict]:
    settings, item = await account(account_id)
    account_id = item["id"]
    async with _locks.setdefault(account_id, asyncio.Lock()):
        token = await read_token(account_id)
        if not token.get("refresh_token") or token.get("client_id") != settings.get("client_id"):
            raise HTTPException(401, "microsoft.accountUnavailable")
        if token.get("expires_at", 0) < time.time() + 60:
            async with httpx.AsyncClient(timeout=30) as client:
                response = await managed_request(client, scope_for_token(settings["client_id"], token, account_id, "oauth"), "POST", f"{AUTHORITY}/token", data={
                    "client_id": settings["client_id"], "grant_type": "refresh_token",
                    "refresh_token": token["refresh_token"], "scope": SCOPES,
                })
            if response.is_error:
                if response.status_code >= 500:
                    logger.warning("Microsoft token service failure account=%s status=%s", account_id, response.status_code)
                    raise HTTPException(503, "microsoft_connection_failed")
                if response.status_code == 400:
                    await save_token(account_id, {})
                raise HTTPException(401, "microsoft.accountUnavailable")
            token.update(response.json())
            token["expires_at"] = time.time() + token.get("expires_in", 3600)
            await save_token(account_id, token)
        return token["access_token"], item


def graph_error_detail(status: int, code: str = "") -> str:
    if status == 403 and code == "ErrorAccountSuspend":
        return "microsoft_account_suspended"
    if status == 429:
        return "microsoft_rate_limited"
    return "microsoft.requestFailed"


def scope_for_token(client_id: str, token: dict, account_id: str, service: str) -> str:
    principal = token.get("email") or token.get("mailbox_id") or account_id
    return limits.request_scope(client_id, principal, service)


async def scope_for_account(account_id: str, service: str) -> str:
    settings, item = await account(account_id)
    token = await read_token(item["id"])
    return scope_for_token(settings.get("client_id", ""), token, item["id"], service)


async def external_request(client: httpx.AsyncClient, method: str, url: str, *, account_id: str,
                           service: str = "drive", **kwargs) -> httpx.Response:
    scope = await scope_for_account(account_id, service)
    return await managed_request(client, scope, method, url, **kwargs)


def graph_service(path: str) -> str:
    if path == "/me":
        return "profile"
    return "drive" if path.startswith(("/me/drive", "/drives/", "/sites/")) else "outlook"


async def graph(path: str, method: str = "GET", *, account_id: str = "", params: dict | None = None,
                json: dict | None = None, content: bytes | None = None, write: bool | str = False,
                raw: bool = False):
    if not path.startswith("/") or path.startswith("//") or "://" in path:
        raise HTTPException(400, "microsoft.invalidRequest")
    batch = json.get("requests", []) if path == "/$batch" and json else []
    services = {graph_service(entry["url"]) for entry in batch} if batch else {graph_service(path)}
    if len(services) != 1:
        raise HTTPException(400, "microsoft.invalidRequest")
    scope = await scope_for_account(account_id, services.pop())
    limits.request_limiter.check(scope)
    token, item = await access_token(account_id)
    allowed_modes = {"draft_only", "send"} if write == "draft" else {"send"}
    if write and item.get("mail_mode", "readonly") not in allowed_modes:
        raise HTTPException(403, "microsoft.writeDisabled")
    request_id = str(uuid.uuid4())
    route = "/".join(path.split("?")[0].split("/")[:3])
    async with httpx.AsyncClient(timeout=60) as client:
        response = await managed_request(client, scope, method, GRAPH_ROOT + path,
            units=len(batch) or 1, batch=bool(batch), params=params, json=json, content=content,
            headers={"Authorization": f"Bearer {token}", "Prefer": 'IdType="ImmutableId"',
                     "client-request-id": request_id})
    if response.is_error:
        try:
            error_code = response.json().get("error", {}).get("code", "unknown")
        except (ValueError, AttributeError):
            error_code = "unknown"
        logger.warning("Graph failure account=%s method=%s route=%s status=%s code=%s request=%s graph_request=%s",
                       item["id"], method, route, response.status_code, error_code, request_id,
                       response.headers.get("request-id", ""))
        raise HTTPException(response.status_code, graph_error_detail(response.status_code, error_code))
    if raw:
        return response
    return response.json() if response.content else {}


async def graph_batch_get(requests: dict[str, str], account_id: str) -> dict[str, dict]:
    """Count each subrequest and execute Outlook batches sequentially in one slot."""
    batch = []
    for key, url in requests.items():
        entry = {"id": key, "method": "GET", "url": url,
                 "headers": {"Prefer": 'IdType="ImmutableId"'}}
        if batch:
            entry["dependsOn"] = [batch[-1]["id"]]
        batch.append(entry)
    if not batch:
        return {}
    payload = await graph("/$batch", "POST", account_id=account_id, json={"requests": batch})
    responses = {entry["id"]: entry for entry in payload.get("responses", [])}
    results = {}
    for key in requests:
        entry = responses.get(key, {})
        status_code = entry.get("status", 502)
        if not 200 <= status_code < 300:
            code = (entry.get("body", {}).get("error") or {}).get("code", "unknown")
            logger.warning("Graph batch failure account=%s item=%s status=%s code=%s",
                           account_id, key, status_code, code)
            raise HTTPException(status_code, graph_error_detail(status_code, code))
        results[key] = entry.get("body", {})
    return results
