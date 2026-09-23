"""User-controlled personal memory management."""
import asyncio
import json
from contextlib import suppress

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logger import get_logger
from services.user_memory import (
    MEMORY_TYPES, delete_all_memories, delete_memory, get_memory_state,
    list_memories, refresh_memories, save_memory, set_memory_enabled,
)

router = APIRouter()
logger = get_logger(__name__)


class MemoryInput(BaseModel):
    content: str
    memory_type: str
    category: str = ""


class MemorySettingsInput(BaseModel):
    enabled: bool


@router.get("/user-memories")
async def get_user_memories():
    state = await get_memory_state()
    return {"enabled": state.get("enabled", True), "memories": await list_memories()}


@router.put("/user-memories/settings")
async def update_user_memory_settings(body: MemorySettingsInput):
    await set_memory_enabled(body.enabled)
    return {"enabled": body.enabled}


@router.post("/user-memories/refresh")
async def refresh_user_memories():
    try:
        return await refresh_memories()
    except RuntimeError as exc:
        raise HTTPException(409, str(exc)) from exc


@router.post("/user-memories/refresh/stream")
async def stream_user_memory_refresh():
    async def events():
        queue: asyncio.Queue[tuple[str, dict]] = asyncio.Queue()

        async def report(data: dict) -> None:
            await queue.put(("progress", data))

        async def run() -> None:
            try:
                result = await refresh_memories(report)
            except RuntimeError as exc:
                code = ("busy" if str(exc) == "Memory analysis is already running"
                        else "disabled" if str(exc) == "User memory is disabled" else "failed")
                await queue.put(("error", {"code": code}))
            except Exception:
                logger.exception("User memory analysis failed")
                await queue.put(("error", {"code": "failed"}))
            else:
                await queue.put(("done", result))

        task = asyncio.create_task(run())
        try:
            yield 'event: status\ndata: {}\n\n'
            while True:
                event, data = await queue.get()
                yield f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"
                if event in {"done", "error"}:
                    break
        finally:
            if not task.done():
                task.cancel()
                with suppress(asyncio.CancelledError):
                    await task

    return StreamingResponse(events(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/user-memories")
async def create_user_memory(body: MemoryInput):
    if body.memory_type not in MEMORY_TYPES:
        raise HTTPException(400, "Invalid memory type")
    return await save_memory(body.content, body.memory_type, body.category)


@router.put("/user-memories/{memory_id}")
async def update_user_memory(memory_id: str, body: MemoryInput):
    if body.memory_type not in MEMORY_TYPES:
        raise HTTPException(400, "Invalid memory type")
    try:
        return await save_memory(body.content, body.memory_type, body.category, memory_id=memory_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc


@router.delete("/user-memories")
async def clear_user_memories():
    await delete_all_memories()
    return {"ok": True}


@router.delete("/user-memories/{memory_id}")
async def remove_user_memory(memory_id: str):
    try:
        await delete_memory(memory_id)
    except ValueError as exc:
        raise HTTPException(404, str(exc)) from exc
    return {"ok": True}
