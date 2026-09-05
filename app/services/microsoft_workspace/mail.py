"""Normalize Outlook messages to the shared mail panel contract."""
import asyncio
import time
from urllib.parse import quote, urlsplit, urlencode

from fastapi import HTTPException

from services.microsoft_workspace.auth import graph, graph_batch_get, account, read_token

FOLDERS = {"INBOX": "inbox", "SENT": "sentitems", "DRAFT": "drafts", "TRASH": "deleteditems", "SPAM": "junkemail", "ARCHIVE": "archive"}
MESSAGE_FIELDS = "id,conversationId,subject,from,toRecipients,ccRecipients,bccRecipients,receivedDateTime,bodyPreview,isRead,flag,hasAttachments,parentFolderId"


def resource_id(value: str) -> str:
    return quote(value, safe="")


def page_path(next_link: str, expected_prefix: str) -> str:
    url = urlsplit(next_link)
    if url.scheme != "https" or url.netloc != "graph.microsoft.com" or not url.path.startswith("/v1.0" + expected_prefix):
        raise HTTPException(400, "microsoft.invalidRequest")
    return url.path[len('/v1.0'):] + ("?" + url.query if url.query else "")


def address(value: dict) -> dict:
    value = value.get("emailAddress") or {}
    return {"name": value.get("name", ""), "email": value.get("address", "")}


def address_text(value: dict) -> str:
    item = address(value)
    return f"{item['name']} <{item['email']}>" if item["name"] else item["email"]


def normalize_message(value: dict, email: str = "") -> dict:
    body = value.get("body") or {}
    sender = address(value.get("from") or {})
    return {"id": value["id"], "threadId": value["id"], "labelIds": [value.get("parentFolderId", "")],
            "from": address_text(value.get("from") or {}),
            "participants": [{**sender, "isMe": sender["email"].lower() == email.lower()}],
            "messageCount": 1, "subject": value.get("subject", ""), "date": value.get("receivedDateTime", ""),
            "snippet": value.get("bodyPreview", ""), "isUnread": not value.get("isRead", False),
            "isStarred": (value.get("flag") or {}).get("flagStatus") == "flagged",
            "hasAttachments": value.get("hasAttachments", False),
            "to": [address(v) for v in value.get("toRecipients", [])],
            "cc": [address(v) for v in value.get("ccRecipients", [])],
            "bcc": [address(v) for v in value.get("bccRecipients", [])], "accountEmail": email,
            "body": body.get("content", "") if body.get("contentType", "").lower() == "text" else value.get("bodyPreview", ""),
            "htmlBody": body.get("content", "") if body.get("contentType", "").lower() == "html" else "",
            "attachments": []}


_folder_ids: dict[tuple[str, str, str], tuple[float, dict[str, str]]] = {}
_folder_locks: dict[str, asyncio.Lock] = {}
_FOLDER_CACHE_SECONDS = 3600
_FOLDER_LIST_PATH = "/me/mailFolders?$top=100&$select=id,displayName,unreadItemCount"


async def _folder_context(account_id: str):
    _, item = await account(account_id)
    account_id = item["id"]
    token = await read_token(account_id)
    # Reconnecting a slot to another mailbox/client must not reuse its IDs.
    key = (account_id, token.get("client_id", ""), token.get("email", ""))
    return account_id, key


async def _load_workspace(label: str | None, account_id: str) -> dict:
    account_id, cache_key = await _folder_context(account_id)
    async with _folder_locks.setdefault(account_id, asyncio.Lock()):
        cached_at, known = _folder_ids.get(cache_key, (0, {}))
        if time.monotonic() - cached_at >= _FOLDER_CACHE_SECONDS:
            known = {}
        requests = {"folders": _FOLDER_LIST_PATH}
        if not known:
            requests.update({key: f"/me/mailFolders/{folder}?$select=id"
                             for key, folder in FOLDERS.items()})
        if label is not None:
            path, params = message_query(label)
            requests["messages"] = path + "?" + urlencode(params)
        data = await graph_batch_get(requests, account_id)
        if not known:
            known = {key: data[key]["id"] for key in FOLDERS}
            _folder_ids[cache_key] = (time.monotonic(), known)
        folders = data["folders"]
        values = list(folders.get("value", []))
        while folders.get("@odata.nextLink"):
            folders = await graph(page_path(folders["@odata.nextLink"], "/me/mailFolders"), account_id=account_id)
            values.extend(folders.get("value", []))
        by_id = {value: key for key, value in known.items()}
        labels_result = [{"id": by_id.get(v["id"], v["id"]), "name": v["displayName"],
                          "type": "system" if v["id"] in by_id else "user",
                          "unreadCount": v.get("unreadItemCount", 0)} for v in values]
        labels_result.append({"id": "STARRED", "name": "STARRED", "type": "system", "unreadCount": 0})
        result = {"labels": labels_result}
        if label is not None:
            result.update(normalize_message_list(data["messages"]))
        return result


async def labels(account_id: str = "") -> dict:
    return await _load_workspace(None, account_id)


async def workspace(label: str = "INBOX", account_id: str = "") -> dict:
    return await _load_workspace(label, account_id)


def message_query(label: str, query: str = "") -> tuple[str, dict]:
    folder = FOLDERS.get(label, label)
    path = f"/me/mailFolders/{resource_id(folder)}/messages"
    params = {"$top": "30", "$select": MESSAGE_FIELDS, "$orderby": "receivedDateTime desc"}
    if label in ("STARRED", "ALL") or query:
        path = "/me/messages"
        if label == "STARRED":
            params["$filter"] = "flag/flagStatus eq 'flagged'"
            params.pop("$orderby")
        if query:
            params["$search"] = '"' + query.replace('"', '') + '"'
            params.pop("$orderby", None)
    return path, params


def normalize_message_list(result: dict) -> dict:
    return {"messages": [normalize_message(item) for item in result.get("value", [])],
            "nextPageToken": result.get("@odata.nextLink")}


async def messages(label: str = "INBOX", page_token: str = "", query: str = "", account_id: str = "") -> dict:
    path, params = message_query(label, query)
    if page_token:
        path, params = page_path(page_token, "/me/"), None
    result = await graph(path, params=params, account_id=account_id)
    return normalize_message_list(result)


async def message(message_id: str, account_id: str = "") -> dict:
    value = await graph(f"/me/messages/{resource_id(message_id)}", account_id=account_id)
    _, item = await account(account_id)
    token = await read_token(item["id"])
    result = normalize_message(value, token.get("email", ""))
    attachments = await graph(f"/me/messages/{resource_id(message_id)}/attachments", account_id=account_id,
                              params={"$top": "100"})
    for inline in attachments.get("value", []):
        if inline.get("isInline") and inline.get("contentId") and inline.get("contentBytes") and inline.get("contentType", "").startswith("image/"):
            result["htmlBody"] = result["htmlBody"].replace("cid:" + inline["contentId"], "data:" + inline["contentType"] + ";base64," + inline["contentBytes"])
    result["attachments"] = [{"id": a["id"], "filename": a.get("name", ""), "mimeType": a.get("contentType", "application/octet-stream"), "size": a.get("size", 0)} for a in attachments.get("value", []) if not a.get("isInline")]
    return result
