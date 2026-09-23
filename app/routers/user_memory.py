"""User-controlled personal memory management."""
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.user_memory import (
    MEMORY_TYPES, delete_all_memories, delete_memory, get_memory_state,
    list_memories, refresh_memories, save_memory, set_memory_enabled,
)

router = APIRouter()


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
