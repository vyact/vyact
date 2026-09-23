"""Tools for managing personal memories during ordinary conversations."""
import json
from contextvars import ContextVar

from services.tool_approval import current_approval_context
from services.user_memory import (
    MEMORY_TYPES, _memory_fingerprint, delete_memory, get_memory_state,
    list_memories, save_memory,
)

TOOL_NAMES = frozenset({
    "user_memory_list", "user_memory_save", "user_memory_update", "user_memory_delete",
})
MEMORY_WRITE_TOOLS = frozenset({"user_memory_save", "user_memory_update"})
memory_write_stage: ContextVar[bool] = ContextVar("memory_write_stage", default=False)
MEMORY_WRITE_INSTRUCTION = (
    "\n\n[Memory review stage] The existing memories have been returned. Compare the current "
    "user fact with that list. Only user_memory_save and user_memory_update are available now. "
    "Update the matching ID when a fact changed; save only a genuinely new topic. "
    "If no durable change is needed, call neither tool and answer normally."
)

AUTO_MEMORY_INSTRUCTION = (
    "[Personal memory] In ordinary chats, use the personal memory tools during this response "
    "when the user states a lasting profile fact, preference, goal, decision, working method, "
    "ongoing project or learning state, or a specific checkpoint and next step that would "
    "help in a later conversation. "
    "An explicit 'remember this' request is not required. For example, if study pauses until "
    "later, remember the current topic and next lesson, not the meal or time of day. "
    "When a lasting fact should be remembered, first call user_memory_list. Its result contains "
    "the full saved list; then decide whether to add a new topic or update an existing ID. "
    "Use a specific, stable category for each topic. "
    "If saving returns needs_review, inspect the matching memories and update the changed fact "
    "by ID, or retry with a more specific category only when it is a distinct fact. "
    "If it returns needs_category, retry with a specific category. "
    "Only say memory was updated after a save or update result includes the saved memory. "
    "Never infer unspoken progress, store assistant suggestions as user facts, or save every turn. "
    "Do not run a separate analysis request. If memory tools are unavailable, continue normally."
)


async def user_memory_tools_available() -> bool:
    if current_approval_context.get().project_id:
        return False
    try:
        return (await get_memory_state()).get("enabled", True)
    except Exception:
        return False


async def _require_available() -> str | None:
    if current_approval_context.get().project_id:
        return "Personal memory tools are unavailable in project conversations."
    try:
        enabled = (await get_memory_state()).get("enabled", True)
    except Exception:
        return "Personal memory is temporarily unavailable."
    if not enabled:
        return "Personal memory is turned off in settings."
    return None


async def _list_memories() -> str:
    if error := await _require_available():
        return json.dumps({"ok": False, "error": error})
    memories = await list_memories()
    memory_write_stage.set(True)
    return json.dumps({
        "ok": True, "memories": memories,
        "next_action": "Review these memories. Use user_memory_update for an existing topic, "
                       "user_memory_save for a distinct new topic, or neither if nothing should change.",
    }, ensure_ascii=False)


async def _save_memory(content: str, memory_type: str, category: str = "") -> str:
    if error := await _require_available():
        return json.dumps({"ok": False, "error": error})
    if memory_type not in MEMORY_TYPES or not content.strip():
        return json.dumps({"ok": False, "error": "Invalid memory type or content."})
    if not category.strip():
        return json.dumps({"ok": True, "saved": False, "needs_category": True})
    normalized = _memory_fingerprint(content)
    memories = await list_memories()
    for existing in memories:
        if _memory_fingerprint(existing["content"]) == normalized:
            return json.dumps({"ok": True, "memory": existing, "unchanged": True}, ensure_ascii=False)
    same_topic = [existing for existing in memories
                  if existing.get("memory_type") == memory_type
                  and _memory_fingerprint(existing.get("category", "")) == _memory_fingerprint(category)]
    if same_topic:
        return json.dumps({
            "ok": True, "saved": False, "needs_review": True,
            "next_action": "Use user_memory_update for a changed fact, or a more specific category for a distinct fact.",
            "matches": [{key: item.get(key, "") for key in ("id", "memory_type", "category", "content")}
                        for item in same_topic],
        }, ensure_ascii=False)
    saved = await save_memory(content, memory_type, category,
                              source_conv_id=current_approval_context.get().conversation_id)
    return json.dumps({"ok": True, "memory": saved}, ensure_ascii=False)


async def _update_memory(memory_id: str, content: str, memory_type: str, category: str = "") -> str:
    if error := await _require_available():
        return json.dumps({"ok": False, "error": error})
    if memory_type not in MEMORY_TYPES or not content.strip():
        return json.dumps({"ok": False, "error": "Invalid memory type or content."})
    try:
        saved = await save_memory(content, memory_type, category, memory_id=memory_id)
    except ValueError:
        return json.dumps({"ok": False, "error": "Memory not found."})
    return json.dumps({"ok": True, "memory": saved}, ensure_ascii=False)


async def _delete_memory(memory_id: str) -> str:
    if error := await _require_available():
        return json.dumps({"ok": False, "error": error})
    try:
        await delete_memory(memory_id)
    except ValueError:
        return json.dumps({"ok": False, "error": "Memory not found."})
    return json.dumps({"ok": True, "deleted_id": memory_id})


def register_user_memory_tools(manager) -> None:
    manager.register_internal_tool(
        name="user_memory_list",
        description=("List saved personal memories and IDs in an ordinary conversation before "
                     "saving or updating a durable fact, preference, or resumable learning/work "
                     "checkpoint. Check for an existing topic to update."),
        parameters={"type": "object", "properties": {}}, handler=_list_memories,
    )
    manager.register_internal_tool(
        name="user_memory_save",
        description=("Save one durable personal fact, preference, or specific learning/work "
                     "checkpoint useful in a later conversation. Explicit 'remember' wording is "
                     "not required. First list memories and update a matching topic. Do not save "
                     "guesses, assistant suggestions, incidental activities, or one-off questions. "
                     "If needs_review is returned, inspect matches and update by ID or choose a "
                     "more specific category for a genuinely distinct fact."),
        parameters={"type": "object", "properties": {
            "content": {"type": "string", "description": "One current user fact, at most 500 characters"},
            "memory_type": {"type": "string", "enum": sorted(MEMORY_TYPES)},
            "category": {"type": "string", "description": "Specific topic key; use the same key for updates"},
        }, "required": ["content", "memory_type", "category"]}, handler=_save_memory,
    )
    manager.register_internal_tool(
        name="user_memory_update",
        description=("Update an existing personal memory when the user corrects it or their "
                     "preference, learning progress, ongoing work, or next step changes. List "
                     "memories first to identify the matching ID."),
        parameters={"type": "object", "properties": {
            "memory_id": {"type": "string"},
            "content": {"type": "string", "description": "The complete current fact"},
            "memory_type": {"type": "string", "enum": sorted(MEMORY_TYPES)},
            "category": {"type": "string"},
        }, "required": ["memory_id", "content", "memory_type"]}, handler=_update_memory,
    )
    manager.register_internal_tool(
        name="user_memory_delete",
        description=("Forget one saved personal memory only when the user explicitly asks you "
                     "to forget or delete it. List memories first to identify the exact ID."),
        parameters={"type": "object", "properties": {
            "memory_id": {"type": "string"},
        }, "required": ["memory_id"]}, handler=_delete_memory,
    )
