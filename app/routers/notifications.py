from fastapi import APIRouter
from pydantic import BaseModel
from services.notifications import create_notification, list_notifications, mark_all_notifications_read

router = APIRouter()


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
