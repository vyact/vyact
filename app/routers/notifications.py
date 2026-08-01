from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from services.notifications import (
    create_notification,
    list_notifications,
    mark_all_notifications_read,
    subscribe_notification_events,
)

router = APIRouter()

NOTIFICATION_STREAM_HEARTBEAT_SECONDS = 15


class NotificationCreateRequest(BaseModel):
    type: str
    source_id: str
    title: str
    message: str = ""
    occurred_at: str = ""
    update_only: bool = False
    account_id: str = ""
    account_email: str = ""


@router.get("/notifications")
async def get_notifications(limit: int = 30, offset: int = 0):
    return await list_notifications(limit, offset)


@router.get("/notifications/stream")
async def stream_notification_changes():
    async def event_stream():
        async for changed in subscribe_notification_events(
            NOTIFICATION_STREAM_HEARTBEAT_SECONDS,
        ):
            if changed:
                yield "event: changed\ndata: {}\n\n"
            else:
                yield ": heartbeat\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


@router.post("/notifications")
async def add_notification(request: NotificationCreateRequest):
    return {"created": await create_notification(
        request.type,
        request.source_id,
        request.title,
        request.message,
        request.occurred_at,
        request.update_only,
        request.account_id,
        request.account_email,
    )}


@router.patch("/notifications/read")
async def read_all_notifications():
    await mark_all_notifications_read()
    return {"ok": True}
