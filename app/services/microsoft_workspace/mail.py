"""Normalize Outlook messages to the shared mail panel contract."""
import asyncio
from urllib.parse import quote, urlsplit

from fastapi import HTTPException

from services.microsoft_workspace.auth import graph, account, read_token

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


async def labels(account_id: str = "") -> dict:
    async def system(key: str, folder: str):
        value = await graph(f"/me/mailFolders/{folder}", account_id=account_id)
        return {"id": key, "name": value.get("displayName", key), "type": "system", "unreadCount": value.get("unreadItemCount", 0)}, value["id"]
    systems = await asyncio.gather(*(system(key, folder) for key, folder in FOLDERS.items()))
    known = {value[1] for value in systems}
    result = [value[0] for value in systems]
    path = "/me/mailFolders?$top=100"
    while path:
        data = await graph(path, account_id=account_id)
        result.extend({"id": v["id"], "name": v["displayName"], "type": "user", "unreadCount": v.get("unreadItemCount", 0)} for v in data.get("value", []) if v["id"] not in known)
        path = page_path(data["@odata.nextLink"], "/me/mailFolders") if data.get("@odata.nextLink") else ""
    result.append({"id": "STARRED", "name": "STARRED", "type": "system", "unreadCount": 0})
    return {"labels": result}


async def messages(label: str = "INBOX", page_token: str = "", query: str = "", account_id: str = "") -> dict:
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
    if page_token:
        path, params = page_path(page_token, "/me/"), None
    result = await graph(path, params=params, account_id=account_id)
    return {"messages": [normalize_message(item) for item in result.get("value", [])], "nextPageToken": result.get("@odata.nextLink")}


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
