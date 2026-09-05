"""Collect Outlook mail notifications without a public webhook server."""
from services.microsoft_workspace.auth import status
from services.microsoft_workspace.mail import messages
from services.notifications import create_notification

_known: dict[str, set[str]] = {}


async def collect_microsoft_notifications() -> None:
    state = await status()
    connected = {item["id"]: item for item in state["accounts"] if item["authenticated"]}
    active = {item["id"] for item in state["config"].get("accounts", []) if item.get("mail_notifications") and item["id"] in connected}
    for account_id in set(_known) - active:
        _known.pop(account_id, None)
    for account_id in active:
        data = await messages(account_id=account_id)
        current = {item["id"] for item in data["messages"]}
        previous = _known.get(account_id)
        for item in data["messages"]:
            if not item["isUnread"] or (previous is not None and item["id"] in previous):
                continue
            await create_notification(notification_type="microsoft_mail", source_id=item["id"], title=item["subject"],
                                      message=item["from"], account_id=account_id, account_email=connected[account_id]["email"], occurred_at=item["date"])
        _known[account_id] = current
