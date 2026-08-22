"""In-app notification history backed by Elasticsearch."""
import asyncio
from collections.abc import AsyncIterator
from datetime import datetime, timezone

from elasticsearch import ConflictError, NotFoundError
from services.db import NOTIFICATIONS_INDEX, get_es


NOTIFICATION_EVENT_QUEUE_SIZE = 1

_notification_change_subscribers: set[asyncio.Queue[None]] = set()


def publish_notification_change() -> None:
    """Notify connected clients that the notification snapshot changed."""
    for subscriber in tuple(_notification_change_subscribers):
        if subscriber.full():
            continue
        subscriber.put_nowait(None)


async def subscribe_notification_events(
    heartbeat_seconds: float,
) -> AsyncIterator[bool]:
    """Yield whether a notification changed, including periodic heartbeats."""
    subscriber: asyncio.Queue[None] = asyncio.Queue(
        maxsize=NOTIFICATION_EVENT_QUEUE_SIZE,
    )
    _notification_change_subscribers.add(subscriber)
    try:
        while True:
            try:
                await asyncio.wait_for(
                    subscriber.get(),
                    timeout=heartbeat_seconds,
                )
                yield True
            except TimeoutError:
                yield False
    finally:
        _notification_change_subscribers.discard(subscriber)


async def has_notification_type(notification_type: str, account_id: str = "") -> bool:
    es = get_es()
    try:
        filters = [{"term": {"type": notification_type}}]
        if account_id:
            filters.append({"term": {"account_id": account_id}})
        result = await es.count(
            index=NOTIFICATIONS_INDEX,
            query={"bool": {"filter": filters}},
        )
        return result["count"] > 0
    finally:
        await es.close()


async def create_notification(
    notification_type: str,
    source_id: str,
    title: str,
    message: str,
    occurred_at: str = "",
    update_only: bool = False,
    account_id: str = "",
    account_email: str = "",
    translations: dict | None = None,
    url: str = "",
    important: bool = False,
    replace_existing: bool = False,
) -> bool:
    es = get_es()
    notification_id = f"{notification_type}:{account_id}:{source_id}"
    try:
        if update_only:
            if occurred_at:
                await es.update(index=NOTIFICATIONS_INDEX, id=notification_id, doc={"occurred_at": occurred_at}, refresh=True)
                publish_notification_change()
            return False
        document = {
            "type": notification_type, "source_id": source_id, "title": title, "message": message,
            "is_read": False, "created_at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        }
        if account_id:
            document["account_id"] = account_id
        if account_email:
            document["account_email"] = account_email
        if occurred_at:
            document["occurred_at"] = occurred_at
        if translations:
            document["translations"] = translations
        if url:
            document["url"] = url
        if important:
            document["important"] = True
        await es.index(index=NOTIFICATIONS_INDEX, id=notification_id, op_type="create", document=document, refresh=True)
        publish_notification_change()
        return True
    except ConflictError:
        if replace_existing:
            updated_document = {
                "title": title,
                "message": message,
                "translations": translations or {},
                "url": url,
                "important": important,
            }
            if occurred_at:
                updated_document["occurred_at"] = occurred_at
            existing = await es.get(index=NOTIFICATIONS_INDEX, id=notification_id)
            existing_document = existing.get("_source", {})
            if all(existing_document.get(key) == value for key, value in updated_document.items()):
                return False
            updated_document["is_read"] = False
            await es.update(
                index=NOTIFICATIONS_INDEX,
                id=notification_id,
                doc=updated_document,
                refresh=True,
            )
            publish_notification_change()
            return False
        if occurred_at:
            await es.update(index=NOTIFICATIONS_INDEX, id=notification_id, doc={"occurred_at": occurred_at}, refresh=True)
            publish_notification_change()
        return False
    except NotFoundError:
        return False
    finally:
        await es.close()


async def list_notifications(limit: int = 30, offset: int = 0) -> dict:
    es = get_es()
    try:
        result = await es.search(index=NOTIFICATIONS_INDEX, body={"query": {"match_all": {}}, "sort": [{"created_at": {"order": "desc"}}], "from": offset, "size": min(limit, 100), "track_total_hits": True})
        total = result["hits"].get("total", 0)
        total = total.get("value", 0) if isinstance(total, dict) else total
        unread = await es.count(index=NOTIFICATIONS_INDEX, query={"term": {"is_read": False}})
        return {"notifications": [{"id": hit["_id"], **hit["_source"]} for hit in result["hits"]["hits"]], "total": total, "unread": unread["count"]}
    finally:
        await es.close()


async def mark_all_notifications_read() -> None:
    es = get_es()
    try:
        await es.update_by_query(index=NOTIFICATIONS_INDEX, query={"term": {"is_read": False}}, script={"source": "ctx._source.is_read = true", "lang": "painless"}, refresh=True)
        publish_notification_change()
    finally:
        await es.close()
