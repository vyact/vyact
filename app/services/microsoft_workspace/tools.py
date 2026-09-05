"""Explicit Microsoft tools, isolated from Google's accounts and tool names."""
import json
from urllib.parse import quote

from services.microsoft_workspace.auth import graph
from services.microsoft_workspace.mail import messages, message


async def search_emails(query: str = "", account_id: str = "") -> str:
    return json.dumps(await messages(query=query, account_id=account_id), ensure_ascii=False)


async def get_email(message_id: str, account_id: str = "") -> str:
    return json.dumps(await message(message_id, account_id), ensure_ascii=False)


async def send_email(to: str, subject: str, body: str, account_id: str = "") -> str:
    await graph("/me/sendMail", "POST", json={"message": {"subject": subject, "body": {"contentType": "Text", "content": body},
                "toRecipients": [{"emailAddress": {"address": email.strip()}} for email in to.split(",") if email.strip()]}, "saveToSentItems": True}, account_id=account_id, write=True)
    return json.dumps({"ok": True})


def register_microsoft_workspace_tools(manager) -> None:
    account_property = {"type": "string", "description": "Microsoft account slot ID; omit to use the active Microsoft account."}
    definitions = [
        ("microsoft_search_emails", "Search Outlook email in the connected Microsoft account.", {"query": {"type": "string"}}, [], search_emails),
        ("microsoft_get_email", "Read an Outlook email and its attachment metadata.", {"message_id": {"type": "string"}}, ["message_id"], get_email),
        ("microsoft_send_email", "Send an Outlook email only when the user requests sending it.", {key: {"type": "string"} for key in ("to", "subject", "body")}, ["to", "subject", "body"], send_email),
    ]
    definitions.extend([
        ("microsoft_create_email_draft", "Create an Outlook draft without sending it.", {key: {"type": "string"} for key in ("to", "subject", "body")}, ["to", "subject", "body"], create_draft),
        ("microsoft_list_calendar_events", "List Outlook calendar events between ISO 8601 start and end times.", {key: {"type": "string"} for key in ("start", "end")}, ["start", "end"], list_events),
        ("microsoft_search_files", "Search OneDrive files; an empty query lists the root folder.", {"query": {"type": "string"}}, [], list_files),
        ("microsoft_create_calendar_event", "Create an Outlook calendar event when requested.", {key: {"type": "string"} for key in ("subject", "start", "end", "timezone")}, ["subject", "start", "end"], create_event),
    ])
    for name, description, properties, required, handler in definitions:
        manager.register_internal_tool(name, description, {"type": "object", "properties": {**properties, "account_id": account_property}, "required": required}, handler, server_type="microsoft_workspace")


async def create_draft(to: str, subject: str, body: str, account_id: str = "") -> str:
    result = await graph("/me/messages", "POST", json={"subject": subject, "body": {"contentType": "Text", "content": body},
                         "toRecipients": [{"emailAddress": {"address": email.strip()}} for email in to.split(",") if email.strip()]}, account_id=account_id, write="draft")
    return json.dumps({"id": result["id"], "isDraft": result.get("isDraft", True)})


async def list_events(start: str, end: str, account_id: str = "") -> str:
    return json.dumps(await graph("/me/calendarView", params={"startDateTime": start, "endDateTime": end, "$top": "100"}, account_id=account_id), ensure_ascii=False)


async def list_files(query: str = "", account_id: str = "") -> str:
    path = "/me/drive/root/search(q='" + quote(query.replace("'", "''"), safe="") + "')" if query else "/me/drive/root/children"
    return json.dumps(await graph(path, account_id=account_id, params={"$top": "100"}), ensure_ascii=False)


async def create_event(subject: str, start: str, end: str, timezone: str = "UTC", account_id: str = "") -> str:
    return json.dumps(await graph("/me/events", "POST", json={"subject": subject, "start": {"dateTime": start, "timeZone": timezone}, "end": {"dateTime": end, "timeZone": timezone}}, account_id=account_id), ensure_ascii=False)
