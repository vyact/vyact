"""Desktop OAuth with PKCE; tokens stay in the integration credential store."""
import asyncio
import base64
import hashlib
import secrets
import time
import uuid
from urllib.parse import urlencode

import httpx
from elasticsearch import NotFoundError
from fastapi import HTTPException

from services.db import INTEGRATION_CREDENTIALS_INDEX, get_es
from services.mcp_config import list_servers

AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0"
GRAPH_ROOT = "https://graph.microsoft.com/v1.0"
SCOPES = "offline_access User.Read Mail.ReadWrite Mail.Send Calendars.ReadWrite Files.ReadWrite"
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
                       "redirect_uri": redirect_uri, "expires_at": now + 600, "generation": _generations.get(account_id, 0)}
    return f"{AUTHORITY}/authorize?{urlencode({'client_id': client_id, 'response_type': 'code', 'redirect_uri': redirect_uri, 'scope': SCOPES, 'state': state, 'code_challenge': challenge, 'code_challenge_method': 'S256', 'prompt': 'select_account'})}"


async def complete_login(state: str, code: str) -> None:
    pending = _pending.pop(state, None)
    if not pending or pending["expires_at"] < time.time():
        raise HTTPException(400, "microsoft.loginExpired")
    settings, _ = await account(pending["account_id"])
    if settings.get("client_id") != pending["client_id"]:
        raise HTTPException(400, "microsoft.loginExpired")
    async with httpx.AsyncClient(timeout=30) as client:
        response = await client.post(f"{AUTHORITY}/token", data={
            "client_id": pending["client_id"], "grant_type": "authorization_code", "code": code,
            "redirect_uri": pending["redirect_uri"], "code_verifier": pending["verifier"], "scope": SCOPES,
        })
        if response.is_error:
            raise HTTPException(401, "microsoft.connectFailed")
        token = response.json()
        profile = await client.get(f"{GRAPH_ROOT}/me", headers={"Authorization": f"Bearer {token['access_token']}"})
        if profile.is_error:
            raise HTTPException(401, "microsoft.connectFailed")
    # A disconnected/deleted account must not be resurrected by an in-flight login.
    current, _ = await account(pending["account_id"])
    if current.get("client_id") != pending["client_id"]:
        raise HTTPException(400, "microsoft.loginExpired")
    if not token.get("refresh_token"):
        raise HTTPException(401, "microsoft.connectFailed")
    token.update(client_id=pending["client_id"], expires_at=time.time() + token.get("expires_in", 3600),
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
                response = await client.post(f"{AUTHORITY}/token", data={
                    "client_id": settings["client_id"], "grant_type": "refresh_token",
                    "refresh_token": token["refresh_token"], "scope": SCOPES,
                })
            if response.is_error:
                if response.status_code == 400:
                    await save_token(account_id, {})
                raise HTTPException(401, "microsoft.accountUnavailable")
            token.update(response.json())
            token["expires_at"] = time.time() + token.get("expires_in", 3600)
            await save_token(account_id, token)
        return token["access_token"], item


async def graph(path: str, method: str = "GET", *, account_id: str = "", params: dict | None = None,
                json: dict | None = None, content: bytes | None = None, write: bool | str = False,
                raw: bool = False):
    if not path.startswith("/") or path.startswith("//") or "://" in path:
        raise HTTPException(400, "microsoft.invalidRequest")
    token, item = await access_token(account_id)
    allowed_modes = {"draft_only", "send"} if write == "draft" else {"send"}
    if write and item.get("mail_mode", "readonly") not in allowed_modes:
        raise HTTPException(403, "microsoft.writeDisabled")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.request(method, GRAPH_ROOT + path, params=params, json=json, content=content,
                                        headers={"Authorization": f"Bearer {token}", "Prefer": 'IdType="ImmutableId"'})
    if response.is_error:
        raise HTTPException(response.status_code, "microsoft.requestFailed")
    if raw:
        return response
    return response.json() if response.content else {}
