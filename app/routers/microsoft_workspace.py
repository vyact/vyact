"""Microsoft account settings and shared workspace browser endpoints."""
import asyncio
import base64
import secrets
import uuid
import re
import zipfile
from io import BytesIO

import httpx
from bs4 import BeautifulSoup
from datetime import datetime, timedelta, timezone
from email.utils import getaddresses
from urllib.parse import quote

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, Response
from pydantic import BaseModel, Field

from services.microsoft_workspace import auth, mail
from routers.google_workspace_browser import MailAiGenerateRequest, MailKnowledgeIndexRequest, generate_mail_body, index_mail_thread_for_knowledge
from services.mcp_config import add_server, list_servers, update_server
from services.db import GOOGLE_WORKSPACE_SETTINGS_INDEX, get_es

router = APIRouter(prefix="/microsoft-workspace")
MAX_MAIL_ATTACHMENT_BYTES = 25 * 1024 * 1024
SMALL_ATTACHMENT_BYTES = 3_000_000
ATTACHMENT_CHUNK_BYTES = 320 * 1024
_config_lock = asyncio.Lock()


class AccountConfig(BaseModel):
    id: str = Field(pattern=r"^[a-zA-Z0-9_-]{1,100}$")
    mail_mode: str = Field(default="readonly", pattern=r"^(readonly|draft_only|send)$")
    mail_notifications: bool = False


class WorkspaceConfig(BaseModel):
    client_id: str = ""
    active_account_id: str = ""
    accounts: list[AccountConfig] = Field(default_factory=list, max_length=20)
    prompt: str = ""


@router.get("/status")
async def status(request: Request):
    return {**(await auth.status()), "redirect_uri": oauth_redirect_uri(request)}


@router.put("/config")
async def save_config(body: WorkspaceConfig):
    async with _config_lock:
        return await _save_config(body)


async def _save_config(body: WorkspaceConfig):
    servers = await list_servers()
    server = next((s for s in servers if s.get("type") == "microsoft_workspace"), None)
    value = body.model_dump()
    if body.client_id:
        try:
            value["client_id"] = str(uuid.UUID(body.client_id.strip()))
        except ValueError:
            raise HTTPException(400, "microsoft.invalidClientId") from None
    ids = [item["id"] for item in value["accounts"]]
    if len(ids) != len(set(ids)) or (body.active_account_id and body.active_account_id not in ids):
        raise HTTPException(400, "microsoft.invalidRequest")
    old = (server or {}).get("config") or {}
    for item in old.get("accounts", []):
        if item["id"] not in ids or old.get("client_id") != value["client_id"]:
            await auth.disconnect(item["id"])
    if server:
        await update_server(server["id"], config=value, prompt=body.prompt)
    else:
        await add_server("microsoft_workspace", value, enabled=False, prompt=body.prompt)
    return await auth.status()


@router.post("/accounts/{account_id}/activate")
async def activate(account_id: str):
    settings, _ = await auth.account(account_id)
    await auth.access_token(account_id)
    server = next(s for s in await list_servers() if s.get("type") == "microsoft_workspace")
    await update_server(server["id"], config={**settings, "active_account_id": account_id})
    return {"ok": True}


def oauth_redirect_uri(request: Request) -> str:
    # Never use an arbitrary Host header as an OAuth callback.
    port = request.scope.get("server", ("localhost", 8000))[1]
    return f"http://localhost:{port}/api/microsoft-workspace/oauth/callback"


@router.post("/accounts/{account_id}/connect")
async def connect(account_id: str, request: Request):
    redirect_uri = oauth_redirect_uri(request)
    return {"url": await auth.start_login(account_id, redirect_uri), "redirect_uri": redirect_uri}


@router.get("/oauth/callback")
async def callback(state: str = "", code: str = "", error: str = ""):
    await auth.complete_login(state, "" if error else code)
    return HTMLResponse('<!doctype html><html><head><meta charset="utf-8"></head><body><p>✓ Microsoft</p><script>window.close()</script></body></html>', headers={"Cache-Control": "no-store"})


@router.post("/accounts/{account_id}/disconnect")
async def disconnect(account_id: str):
    await auth.account(account_id)
    await auth.disconnect(account_id)
    return {"ok": True}


@router.get("/mail/labels")
async def labels(account_id: str = ""):
    return await mail.labels(account_id)


@router.get("/mail/messages")
async def messages(label: str = "INBOX", page_token: str = "", query: str = "", account_id: str = ""):
    return await mail.messages(label, page_token, query, account_id)


@router.get("/mail/workspace")
async def workspace(label: str = "INBOX", account_id: str = ""):
    return await mail.workspace(label, account_id)


@router.get("/mail/messages/{message_id}")
async def message(message_id: str, account_id: str = ""):
    return await mail.message(message_id, account_id)


@router.patch("/mail/messages/{message_id}/read")
async def read_message(message_id: str, account_id: str = ""):
    # Opening a message may mark it read, matching the existing Google read-only UI policy.
    await auth.graph(f"/me/messages/{mail.resource_id(message_id)}", "PATCH", json={"isRead": True}, account_id=account_id)
    return {"ok": True}


@router.patch("/mail/messages/{message_id}/star")
async def star(message_id: str, request: Request, account_id: str = ""):
    body = await request.json()
    await auth.graph(f"/me/messages/{mail.resource_id(message_id)}", "PATCH", json={"flag": {"flagStatus": "flagged" if body.get("starred") else "notFlagged"}}, account_id=account_id)
    return {"ok": True}


@router.post("/mail/labels")
async def create_folder(request: Request, account_id: str = ""):
    body = await request.json()
    value = await auth.graph("/me/mailFolders", "POST", json={"displayName": body["name"]}, account_id=account_id)
    return {"id": value["id"], "name": value["displayName"]}


@router.api_route("/mail/labels/{label_id}", methods=["PATCH", "DELETE"])
async def change_folder(label_id: str, request: Request, account_id: str = ""):
    body = {"displayName": (await request.json())["name"]} if request.method == "PATCH" else None
    await auth.graph(f"/me/mailFolders/{mail.resource_id(label_id)}", request.method, json=body, account_id=account_id)
    return {"ok": True}


@router.post("/mail/{kind}/{action}")
async def bulk_mail(kind: str, action: str, request: Request, account_id: str = ""):
    if kind not in ("messages", "threads") or action not in ("trash", "delete", "move"):
        raise HTTPException(404, "microsoft.invalidRequest")
    body = await request.json()
    ids = body.get("message_ids") or body.get("thread_ids") or []
    for message_id in ids:
        path = f"/me/messages/{mail.resource_id(message_id)}"
        if action == "delete":
            current = await auth.graph(path, account_id=account_id, params={"$select": "parentFolderId"})
            trash = await auth.graph("/me/mailFolders/deleteditems", account_id=account_id)
            if current.get("parentFolderId") != trash["id"]:
                raise HTTPException(400, "microsoft.invalidRequest")
            await auth.graph(path + "/permanentDelete", "POST", account_id=account_id)
        else:
            destination = "deleteditems" if action == "trash" else body.get("target_label_id", body.get("label_id", ""))
            await auth.graph(path + "/move", "POST", json={"destinationId": mail.FOLDERS.get(destination, destination)}, account_id=account_id)
    return {"ok": True}


@router.get("/mail/messages/{message_id}/attachments/{attachment_id}")
async def attachment(message_id: str, attachment_id: str, account_id: str = ""):
    value = await auth.graph(f"/me/messages/{mail.resource_id(message_id)}/attachments/{mail.resource_id(attachment_id)}", account_id=account_id)
    return Response(base64.b64decode(value.get("contentBytes", "")), media_type=value.get("contentType", "application/octet-stream"))


@router.post("/mail/send")
async def send_mail(request: Request, account_id: str = ""):
    data = await request.form()
    def recipients(key: str):
        return [{"emailAddress": {"name": name, "address": email}} for name, email in getaddresses([str(data.get(key, ""))]) if email]
    message_body = {"subject": str(data.get("subject", "")), "body": {"contentType": "HTML" if data.get("html_body") else "Text", "content": str(data.get("html_body") or data.get("body", ""))},
                    "toRecipients": recipients("to"), "ccRecipients": recipients("cc"), "bccRecipients": recipients("bcc")}
    uploads = []
    total = 0
    for key in ("attachments", "inline_images"):
        for upload in data.getlist(key):
            content = await upload.read(MAX_MAIL_ATTACHMENT_BYTES + 1)
            total += len(content)
            if total > MAX_MAIL_ATTACHMENT_BYTES:
                raise HTTPException(413, "microsoft.attachmentLimit")
            uploads.append((upload, content, key == "inline_images"))
    if data.get("reply_to"):
        draft = await auth.graph(f"/me/messages/{mail.resource_id(str(data['reply_to']))}/createReply", "POST", account_id=account_id)
        await auth.graph(f"/me/messages/{mail.resource_id(draft['id'])}", "PATCH", json=message_body, account_id=account_id)
    else:
        draft = await auth.graph("/me/messages", "POST", json=message_body, account_id=account_id)
    draft_path = f"/me/messages/{mail.resource_id(draft['id'])}"
    # Upload attachments individually to keep JSON requests below Graph's request-size limit.
    # If upload/send fails, retain the recoverable draft rather than silently deleting user text.
    for upload, content, inline in uploads:
        if len(content) < SMALL_ATTACHMENT_BYTES:
            await auth.graph(draft_path + "/attachments", "POST", json={
                "@odata.type": "#microsoft.graph.fileAttachment", "name": upload.filename,
                "contentType": upload.content_type or "application/octet-stream",
                "contentBytes": base64.b64encode(content).decode(), "isInline": inline, "contentId": upload.filename,
            }, account_id=account_id)
        else:
            session = await auth.graph(draft_path + "/attachments/createUploadSession", "POST", json={"AttachmentItem": {
                "attachmentType": "file", "name": upload.filename, "size": len(content), "isInline": inline, "contentId": upload.filename,
            }}, account_id=account_id)
            upload_url = session["uploadUrl"]
            if not upload_url.startswith("https://"):
                raise HTTPException(502, "microsoft.requestFailed")
            async with httpx.AsyncClient(timeout=60) as client:
                for offset in range(0, len(content), ATTACHMENT_CHUNK_BYTES):
                    chunk = content[offset:offset + ATTACHMENT_CHUNK_BYTES]
                    result = await client.put(upload_url, content=chunk, headers={
                        "Content-Type": "application/octet-stream", "Content-Length": str(len(chunk)),
                        "Content-Range": f"bytes {offset}-{offset + len(chunk) - 1}/{len(content)}",
                    })
                    if result.is_error:
                        raise HTTPException(502, "microsoft.requestFailed")
    await auth.graph(draft_path + "/send", "POST", account_id=account_id)
    return {"ok": True, "id": draft["id"], "threadId": draft["id"]}


@router.api_route("/accounts/{account_id}/mail/signature", methods=["GET", "PUT"])
async def signature(account_id: str, request: Request):
    await auth.account(account_id)
    es = get_es()
    key = f"microsoft_signature_{account_id}"
    try:
        if request.method == "PUT":
            value = await request.json()
            await es.index(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key, document={"key": key, "value": value}, refresh=True)
            return value
        if not await es.exists(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key):
            return {"signature_html": "", "enabled": True, "macros": []}
        return (await es.get(index=GOOGLE_WORKSPACE_SETTINGS_INDEX, id=key))["_source"]["value"]
    finally:
        await es.close()


def calendar_path(calendar_id: str) -> str:
    return "/me/calendar" if calendar_id == "primary" else f"/me/calendars/{mail.resource_id(calendar_id)}"


def normalize_event(value: dict) -> dict:
    body = value.get("body") or {}
    description = body.get("content", "")
    if body.get("contentType", "").lower() == "html":
        document = BeautifulSoup(description, "html.parser")
        for element in document(["script", "style", "head"]):
            element.decompose()
        description = document.get_text("\n", strip=True)

    def date_value(field: str):
        item = value.get(field) or {}
        stamp = item.get("dateTime", "")
        if value.get("isAllDay"):
            return {"date": stamp[:10]}
        if stamp:
            parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
            if parsed.tzinfo is None and item.get("timeZone", "UTC") == "UTC":
                parsed = parsed.replace(tzinfo=timezone.utc)
            stamp = parsed.isoformat()
        return {"dateTime": stamp, "timeZone": item.get("timeZone", "UTC")}
    return {"id": value["id"], "summary": value.get("subject", ""), "description": description,
            "location": (value.get("location") or {}).get("displayName", ""), "start": date_value("start"), "end": date_value("end"),
            "htmlLink": value.get("webLink", ""), "reminders": {"useDefault": False, "overrides": [{"method": "popup", "minutes": value.get("reminderMinutesBeforeStart", 15)}] if value.get("isReminderOn") else []}}


@router.get("/calendar/calendars")
async def calendars(account_id: str = ""):
    value = await auth.graph("/me/calendars", account_id=account_id)
    return {"calendars": [{"id": v["id"], "summary": v["name"], "primary": v.get("isDefaultCalendar", False)} for v in value.get("value", [])]}


@router.get("/calendar/events")
async def events(time_min: str = "", time_max: str = "", calendar_id: str = "primary", q: str = "", account_id: str = ""):
    now = datetime.now(timezone.utc)
    data = await auth.graph(calendar_path(calendar_id) + "/calendarView", params={
        "startDateTime": time_min or now.isoformat(), "endDateTime": time_max or (now + timedelta(days=30)).isoformat(),
        "$top": "250", "$orderby": "start/dateTime"}, account_id=account_id)
    values = data.get("value", [])
    while data.get("@odata.nextLink"):
        data = await auth.graph(mail.page_path(data["@odata.nextLink"], "/me/"), account_id=account_id)
        values.extend(data.get("value", []))
    return {"events": [normalize_event(value) for value in values if not q or q.casefold() in value.get("subject", "").casefold()]}


@router.api_route("/calendar/events/{event_id}", methods=["GET", "PATCH", "DELETE"])
async def event(event_id: str, request: Request, account_id: str = ""):
    path = f"/me/events/{mail.resource_id(event_id)}"
    if request.method == "GET":
        return normalize_event(await auth.graph(path, account_id=account_id))
    body = event_body(await request.json()) if request.method == "PATCH" else None
    result = await auth.graph(path, request.method, json=body, account_id=account_id)
    return normalize_event(result) if result else {"ok": True}


def event_body(body: dict) -> dict:
    value = {}
    for source, target in (("summary", "subject"),):
        if source in body:
            value[target] = body[source]
    for key in ("start", "end"):
        if key in body:
            stamp = body[key]
            all_day = len(stamp) == 10
            if not all_day:
                parsed = datetime.fromisoformat(stamp.replace("Z", "+00:00"))
                if parsed.tzinfo:
                    stamp = parsed.astimezone(timezone.utc).replace(tzinfo=None).isoformat()
            value[key] = {"dateTime": stamp + "T00:00:00" if all_day else stamp, "timeZone": "UTC" if not all_day and parsed.tzinfo else body.get("timezone", "UTC")}
            value["isAllDay"] = all_day
    if "description" in body:
        value["body"] = {"contentType": "Text", "content": body["description"]}
    if "location" in body:
        value["location"] = {"displayName": body["location"]}
    if body.get("reminders") is not None:
        reminders = body["reminders"]
        if len(reminders) > 1 or any(item.get("method") != "popup" for item in reminders):
            raise HTTPException(400, "microsoft.reminderLimit")
        value["isReminderOn"] = bool(reminders)
        if reminders:
            value["reminderMinutesBeforeStart"] = reminders[0]["minutes"]
    return value


@router.post("/calendar/events")
async def create_event(request: Request, account_id: str = ""):
    body = await request.json()
    return normalize_event(await auth.graph(calendar_path(body.get("calendar_id", "primary")) + "/events", "POST", json=event_body(body), account_id=account_id))


def drive_path(file_id: str) -> str:
    return "/me/drive/root" if file_id == "root" else f"/me/drive/items/{mail.resource_id(file_id)}"


def normalize_file(value: dict) -> dict:
    return {"id": value["id"], "name": value.get("name", ""), "mimeType": "application/vnd.google-apps.folder" if "folder" in value else (value.get("file") or {}).get("mimeType", "application/octet-stream"),
            "shared": value.get("shared") is not None,
            "size": str(value.get("size", 0)), "modifiedTime": value.get("lastModifiedDateTime", ""), "webViewLink": value.get("webUrl", ""),
            "parents": [(value.get("parentReference") or {}).get("id", "root")], "capabilities": {"canEdit": True, "canDelete": True, "canShare": True}}


@router.get("/drive/files")
async def drive_files(folder_id: str = "root", query: str = "", page_token: str = "", order_by: str = "name", order_direction: str = "asc", account_id: str = ""):
    order = {"name": "name", "modifiedTime": "lastModifiedDateTime", "size": "size"}.get(order_by, "name")
    params = {"$top": "50", "$orderby": f"{order} {'desc' if order_direction == 'desc' else 'asc'}"}
    path = drive_path(folder_id) + "/children"
    if query:
        path = drive_path(folder_id) + "/search(q='" + quote(query.replace("'", "''"), safe="") + "')"
        params = {"$top": "50"}
    if page_token:
        path, params = mail.page_path(page_token, "/"), None
    value = await auth.graph(path, params=params, account_id=account_id)
    return {"files": [normalize_file(v) for v in value.get("value", [])], "nextPageToken": value.get("@odata.nextLink")}


@router.get("/drive/folders")
async def drive_folders(parent_id: str = "root", account_id: str = ""):
    data = await auth.graph(drive_path(parent_id) + "/children", account_id=account_id, params={"$top": "200"})
    values = data.get("value", [])
    while data.get("@odata.nextLink"):
        data = await auth.graph(mail.page_path(data["@odata.nextLink"], "/"), account_id=account_id)
        values.extend(data.get("value", []))
    return {"folders": [normalize_file(v) for v in values if "folder" in v]}


@router.post("/drive/folders")
async def create_drive_folder(request: Request, account_id: str = ""):
    body = await request.json()
    return normalize_file(await auth.graph(drive_path(body.get("parent_id", "root")) + "/children", "POST", json={"name": body["name"], "folder": {}, "@microsoft.graph.conflictBehavior": "fail"}, account_id=account_id))


@router.delete("/drive/files/{file_id}")
async def delete_file(file_id: str, account_id: str = ""):
    await auth.graph(drive_path(file_id), "DELETE", account_id=account_id)
    return {"ok": True}


@router.patch("/drive/files/{file_id}/rename")
async def rename_file(file_id: str, request: Request, account_id: str = ""):
    body = await request.json()
    return normalize_file(await auth.graph(drive_path(file_id), "PATCH", json={"name": body["name"]}, account_id=account_id))


@router.post("/drive/files/batch-trash")
async def trash_files(request: Request, account_id: str = ""):
    for file_id in (await request.json()).get("file_ids", []):
        await auth.graph(drive_path(file_id), "DELETE", account_id=account_id)
    return {"ok": True}


@router.post("/drive/files/batch-move")
async def move_files(request: Request, account_id: str = ""):
    body = await request.json()
    target = await auth.graph(drive_path(body["target_folder_id"]), account_id=account_id)
    moved = []
    for file_id in body.get("file_ids", []):
        await auth.graph(drive_path(file_id), "PATCH", json={"parentReference": {"id": target["id"]}}, account_id=account_id)
        moved.append(file_id)
    return {"ok": True, "moved_ids": moved}


@router.get("/drive/files/{file_id}/download")
async def download_file(file_id: str, account_id: str = ""):
    # Graph returns a short-lived download URL. Do not forward the bearer token to its host.
    metadata = await auth.graph(drive_path(file_id), account_id=account_id)
    url = metadata.get("@microsoft.graph.downloadUrl")
    if not url or not url.startswith("https://"):
        raise HTTPException(400, "microsoft.requestFailed")
    async with httpx.AsyncClient(timeout=60) as client:
        response = await client.get(url)
    if response.is_error:
        raise HTTPException(502, "microsoft.requestFailed")
    return Response(response.content, media_type=(metadata.get("file") or {}).get("mimeType", "application/octet-stream"))


@router.post("/drive/upload")
async def upload_files(request: Request, account_id: str = ""):
    form = await request.form()
    root = str(form.get("folder_id", "root"))
    folders = {"": root}
    def path_parts(path: str) -> list[str]:
        parts = path.replace("\\", "/").split("/")
        if any(part in (".", "..") for part in parts) or path.startswith("/"):
            raise HTTPException(400, "microsoft.invalidRequest")
        return [part for part in parts if part]
    async def ensure_folder(parts: list[str]) -> str:
        current = root
        for index, name in enumerate(parts):
            key = "/".join(parts[:index + 1])
            if key not in folders:
                try:
                    item = await auth.graph(drive_path(current) + ":/" + quote(name, safe=""), account_id=account_id)
                    if "folder" not in item:
                        raise HTTPException(409, "microsoft.invalidRequest")
                except HTTPException as error:
                    if error.status_code != 404:
                        raise
                    item = await auth.graph(drive_path(current) + "/children", "POST", json={"name": name, "folder": {}, "@microsoft.graph.conflictBehavior": "fail"}, account_id=account_id)
                folders[key] = item["id"]
            current = folders[key]
        return current
    for directory in form.getlist("directories"):
        await ensure_folder(path_parts(str(directory)))
    files = []
    paths = form.getlist("paths")
    for index, upload in enumerate(form.getlist("files")):
        parts = path_parts(str(paths[index]) if index < len(paths) else upload.filename)
        if not parts:
            raise HTTPException(400, "microsoft.invalidRequest")
        parent = await ensure_folder(parts[:-1])
        content = await upload.read(MAX_MAIL_ATTACHMENT_BYTES + 1)
        if len(content) > MAX_MAIL_ATTACHMENT_BYTES:
            raise HTTPException(413, "microsoft.requestFailed")
        path = drive_path(parent) + ":/" + quote(parts[-1], safe="") + ":/content"
        value = await auth.graph(path, "PUT", content=content, account_id=account_id,
                                 params={"@microsoft.graph.conflictBehavior": "replace" if form.get("replace") == "true" else "fail"})
        files.append(normalize_file(value))
    return {"files": files}


@router.post("/mail/generate")
async def generate(body: MailAiGenerateRequest, account_id: str = ""):
    await auth.account(account_id)
    return await generate_mail_body(body)


@router.post("/mail/threads/{thread_id}/knowledge-index")
async def knowledge(thread_id: str, body: MailKnowledgeIndexRequest, account_id: str = ""):
    _, item = await auth.account(account_id or body.account_id)
    if item["id"] != body.account_id or not body.thread_messages:
        raise HTTPException(400, "microsoft.invalidRequest")
    return await index_mail_thread_for_knowledge(thread_id, body)


@router.post("/drive/files/check-duplicates")
async def duplicates(request: Request, account_id: str = ""):
    body = await request.json()
    existing = set()
    data = await auth.graph(drive_path(body.get("folder_id", "root")) + "/children", params={"$top": "200"}, account_id=account_id)
    while True:
        existing.update(v["name"] for v in data.get("value", []))
        if not data.get("@odata.nextLink"):
            break
        data = await auth.graph(mail.page_path(data["@odata.nextLink"], "/"), account_id=account_id)
    return {"duplicates": [name for name in body.get("names", []) if name in existing]}


@router.post("/drive/files/{file_id}/copy")
async def copy_file(file_id: str, request: Request, account_id: str = ""):
    body = await request.json()
    response = await auth.graph(drive_path(file_id) + "/copy", "POST", json={"name": body["name"]}, account_id=account_id, raw=True)
    monitor = response.headers.get("Location", "")
    url = httpx.URL(monitor)
    if url.scheme != "https" or not (url.host == "graph.microsoft.com" or url.host == "api.onedrive.com" or url.host.endswith(".sharepoint.com")):
        raise HTTPException(502, "microsoft.requestFailed")
    async with httpx.AsyncClient(timeout=30) as client:
        for _ in range(30):
            result = await client.get(monitor)
            if result.status_code == 303:
                location = result.headers.get("Location", "")
                resource = location.split("/items/")[-1].split("?")[0]
                if resource and resource != location:
                    return normalize_file(await auth.graph(drive_path(resource), account_id=account_id))
            if result.is_error:
                raise HTTPException(502, "microsoft.requestFailed")
            data = result.json()
            if data.get("status", "").lower() == "completed" and data.get("resourceId"):
                return normalize_file(await auth.graph(drive_path(data["resourceId"]), account_id=account_id))
            if data.get("status", "").lower() in ("failed", "deletefailed"):
                raise HTTPException(502, "microsoft.requestFailed")
            await asyncio.sleep(1)
    raise HTTPException(504, "microsoft.requestFailed")


def normalize_permission(value: dict, owner: dict | None = None) -> dict:
    identity_sets = [value.get("grantedToV2") or {}, value.get("grantedTo") or {}]
    identity_sets.extend(value.get("grantedToIdentitiesV2") or value.get("grantedToIdentities") or [])
    users = [identity for item in identity_sets for identity in [item.get("user"), item.get("siteUser")] if identity]
    emails = list(dict.fromkeys(user["email"] for user in users if user.get("email")))
    names = list(dict.fromkeys(user["displayName"] for user in users if user.get("displayName")))
    role = "owner" if "owner" in value.get("roles", []) else "writer" if "write" in value.get("roles", []) else "reader"
    email = ", ".join(emails) or (value.get("invitation") or {}).get("email", "")
    name = ", ".join(names)
    if role == "owner" and owner:
        email = email or owner.get("email", "")
        name = name or owner.get("displayName", "")
    return {"id": value["id"], "type": "anyone" if value.get("link", {}).get("scope") == "anonymous" else "user",
            "role": role, "emailAddress": email, "displayName": name}


@router.get("/drive/files/{file_id}/permissions")
async def permissions(file_id: str, account_id: str = ""):
    values, metadata = await asyncio.gather(auth.graph(drive_path(file_id) + "/permissions", account_id=account_id), auth.graph(drive_path(file_id), account_id=account_id))
    owner = {}
    if any("owner" in value.get("roles", []) and not (normalize_permission(value)["displayName"] or normalize_permission(value)["emailAddress"]) for value in values.get("value", [])):
        drive = await auth.graph("/me/drive", account_id=account_id)
        owner = (drive.get("owner") or {}).get("user") or {}
    return {"permissions": [normalize_permission(value, owner) for value in values.get("value", [])], "link": next((value["link"]["webUrl"] for value in values.get("value", []) if value.get("link", {}).get("scope") == "anonymous" and value["link"].get("webUrl")), metadata.get("webUrl", ""))}


@router.post("/drive/files/{file_id}/permissions")
async def invite(file_id: str, request: Request, account_id: str = ""):
    body = await request.json()
    result = await auth.graph(drive_path(file_id) + "/invite", "POST", json={"recipients": [{"email": body["email"]}], "roles": ["write" if body.get("role") == "writer" else "read"], "requireSignIn": True, "sendInvitation": True}, account_id=account_id)

    errors = [item["error"] for item in result.get("value", []) if item.get("error")]
    if errors:
        codes = []
        for error in errors:
            while isinstance(error, dict):
                if error.get("code"):
                    codes.append(error["code"])
                error = error.get("innererror") or error.get("innerError")
        return {**result, "notificationFailed": True, "verificationRequired": any(code in ("accountVerificationRequired", "hipCheckRequired") for code in codes)}
    return result


@router.delete("/drive/files/{file_id}/permissions/{permission_id}")
async def delete_permission(file_id: str, permission_id: str, account_id: str = ""):
    await auth.graph(drive_path(file_id) + f"/permissions/{mail.resource_id(permission_id)}", "DELETE", account_id=account_id)
    return {"ok": True}


@router.put("/drive/files/{file_id}/general-access")
async def general_access(file_id: str, request: Request, account_id: str = ""):
    body = await request.json()
    path = drive_path(file_id)
    if body["role"] == "private":
        data = await auth.graph(path + "/permissions", account_id=account_id)
        for value in data.get("value", []):
            if value.get("link", {}).get("scope") == "anonymous":
                await auth.graph(path + f"/permissions/{mail.resource_id(value['id'])}", "DELETE", account_id=account_id)
    else:
        await auth.graph(path + "/createLink", "POST", json={"type": "edit" if body["role"] == "writer" else "view", "scope": "anonymous"}, account_id=account_id)
    return await permissions(file_id, account_id)


_download_jobs: dict[str, dict] = {}
MAX_ARCHIVE_BYTES = 250 * 1024 * 1024
MAX_ARCHIVE_FILES = 1000


def safe_filename(value: str) -> str:
    return re.sub(r'[\\/\x00-\x1f]', '_', value).strip('. ') or 'file'


async def build_archive(job_id: str, file_ids: list[str], account_id: str) -> None:
    job = _download_jobs[job_id]
    try:
        buffer = BytesIO()
        total_bytes = 0
        visited = set()
        async def add_item(archive, file_id, parent=""):
            nonlocal total_bytes
            if file_id in visited or len(visited) >= MAX_ARCHIVE_FILES:
                raise HTTPException(413, "microsoft.requestFailed")
            visited.add(file_id)
            metadata = await auth.graph(drive_path(file_id), account_id=account_id)
            path = parent + safe_filename(metadata.get("name", "file"))
            if "folder" in metadata:
                archive.writestr(path + "/", b"")
                data = await auth.graph(drive_path(file_id) + "/children", account_id=account_id)
                while True:
                    for child in data.get("value", []):
                        await add_item(archive, child["id"], path + "/")
                    if not data.get("@odata.nextLink"):
                        break
                    data = await auth.graph(mail.page_path(data["@odata.nextLink"], "/"), account_id=account_id)
            else:
                total_bytes += metadata.get("size", 0)
                if total_bytes > MAX_ARCHIVE_BYTES:
                    raise HTTPException(413, "microsoft.requestFailed")
                response = await download_file(file_id, account_id)
                archive.writestr(path, response.body)
                job["completed"] += 1
                job["total"] = job["completed"]
        with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
            for file_id in file_ids:
                await add_item(archive, file_id)
        job.update(status="complete", content=buffer.getvalue())
    except asyncio.CancelledError:
        raise
    except Exception:
        job.update(status="error", code="request_failed")
    finally:
        asyncio.get_running_loop().call_later(600, _download_jobs.pop, job_id, None)


async def start_download_job(file_ids: list[str], name: str, account_id: str) -> dict:
    _, account = await auth.account(account_id)
    job_id = secrets.token_urlsafe(24)
    _download_jobs[job_id] = {"status": "compressing", "completed": 0, "total": 0, "account_id": account["id"], "name": safe_filename(name) + ".zip"}
    _download_jobs[job_id]["task"] = asyncio.create_task(build_archive(job_id, file_ids, account["id"]))
    return {"jobId": job_id}


@router.post("/drive/files/{file_id}/download-jobs")
async def folder_download_job(file_id: str, account_id: str = ""):
    return await start_download_job([file_id], "OneDrive", account_id)


@router.post("/drive/download-jobs")
async def bulk_download_job(request: Request, account_id: str = ""):
    body = await request.json()
    return await start_download_job(body["file_ids"], body.get("archive_name", "OneDrive"), account_id)


async def download_job(job_id: str, account_id: str) -> dict:
    _, account = await auth.account(account_id)
    job = _download_jobs.get(job_id)
    if not job or job["account_id"] != account["id"]:
        raise HTTPException(404, "microsoft.invalidRequest")
    return job


@router.get("/drive/download-jobs/{job_id}")
async def job_status(job_id: str, account_id: str = ""):
    job = await download_job(job_id, account_id)
    return {key: job[key] for key in ("status", "completed", "total", "code") if key in job}


@router.get("/drive/download-jobs/{job_id}/file")
async def job_file(job_id: str, account_id: str = ""):
    job = await download_job(job_id, account_id)
    if job["status"] != "complete":
        raise HTTPException(409, "microsoft.requestFailed")
    return Response(job["content"], media_type="application/zip", headers={"Content-Disposition": "attachment; filename*=UTF-8''" + quote(job["name"])})


@router.delete("/drive/download-jobs/{job_id}")
async def cancel_job(job_id: str, account_id: str = ""):
    job = await download_job(job_id, account_id)
    job["task"].cancel()
    _download_jobs.pop(job_id, None)
    return {"ok": True}
