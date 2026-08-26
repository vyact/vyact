"""Project-scoped memory extracted from ordinary chat responses.

This module deliberately has no MCP dependency. The selected chat model emits a
hidden JSON block together with its normal answer; the block is then merged into
the project document in Elasticsearch.
"""
import json
import re
import uuid
from datetime import datetime, timezone

from logger import get_logger
from services.db import PROJECTS_INDEX, get_es

logger = get_logger(__name__)

# Small local models sometimes replace the opening ``>`` with ``=``.
# Treat that variant as internal metadata too so it never leaks into chat.
PROJECT_MEMORY_TAG_RE = re.compile(
    r"<project_memory\s*(?:>|=)\s*([\s\S]*?)</project_memory\s*>",
    re.IGNORECASE,
)
PROJECT_MEMORY_ITEM_TYPES = {"decision": "decisions", "action_item": "action_items"}
PROJECT_MEMORY_STATUSES = {"active", "completed"}
PROJECT_MEMORY_PROMPT_ITEM_LIMIT = 50


def empty_project_memory() -> dict:
    return {"summary": "", "decisions": [], "action_items": [], "updated_at": ""}


def _normalize_text(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def project_memory_prompt_view(memory: dict) -> dict:
    """Keep model context useful and bounded while full metadata stays local."""
    def compact(items: object) -> list[dict]:
        if not isinstance(items, list):
            return []
        active = [item for item in items if isinstance(item, dict) and item.get("status") != "completed"]
        completed = [item for item in items if isinstance(item, dict) and item.get("status") == "completed"][-10:]
        return [
            {key: item.get(key, "") for key in ("text", "status", "owner", "due_date") if item.get(key)}
            for item in (active + completed)[-PROJECT_MEMORY_PROMPT_ITEM_LIMIT:]
        ]
    return {
        "summary": _normalize_text(memory.get("summary")),
        "decisions": compact(memory.get("decisions")),
        "action_items": compact(memory.get("action_items")),
    }


def extract_project_memory_tag(answer: str) -> tuple[str, dict | None]:
    match = PROJECT_MEMORY_TAG_RE.search(answer)
    if not match:
        return answer.strip(), None
    clean_answer = PROJECT_MEMORY_TAG_RE.sub("", answer).strip()
    try:
        payload = json.loads(match.group(1).strip())
        return clean_answer, payload if isinstance(payload, dict) else None
    except (json.JSONDecodeError, TypeError) as exc:
        logger.warning("[project_memory] JSON 파싱 실패: %s", exc)
        return clean_answer, None


async def get_project_memory(project_id: str) -> dict:
    if not project_id:
        return empty_project_memory()
    es = get_es()
    try:
        result = await es.get(index=PROJECTS_INDEX, id=project_id)
        memory = result.get("_source", {}).get("memory")
        return {**empty_project_memory(), **memory} if isinstance(memory, dict) else empty_project_memory()
    except Exception:
        return empty_project_memory()
    finally:
        await es.close()


def build_project_memory_instruction(memory: dict) -> str:
    current = json.dumps(project_memory_prompt_view(memory), ensure_ascii=False, separators=(",", ":"))
    return (
        "\n\n## Project memory update (hidden; never mention it to the user)\n"
        "The current project memory follows. Update it only with facts explicitly confirmed by this user message and response. "
        "Never turn guesses or general advice into decisions or action items.\n"
        f"Current memory: {current}\n"
        "At the very end, output the JSON tag below exactly once. Keep summary to at most four sentences while preserving prior key context and reflecting this turn. "
        "Put only newly confirmed items from this turn in decisions and action_items; use empty arrays when there are none. "
        "Include due_date as an ISO 8601 date and owner only when explicitly stated.\n"
        '<project_memory>{"summary":"...","decisions":["..."],'
        '"action_items":[{"text":"...","owner":"","due_date":""}]}</project_memory>\n'
        "Put no text other than JSON inside the tag."
    )


def _new_item(text: str, conv_id: str, **extra: str) -> dict:
    now = datetime.now(timezone.utc).isoformat()
    return {
        "id": str(uuid.uuid4()), "text": text, "status": "active",
        "source_conv_id": conv_id, "created_at": now, "updated_at": now, **extra,
    }


async def merge_project_memory(project_id: str, conv_id: str, extracted: dict | None) -> None:
    if not project_id or not extracted:
        return
    es = get_es()
    try:
        result = await es.get(index=PROJECTS_INDEX, id=project_id)
        source = result.get("_source", {})
        memory = {**empty_project_memory(), **(source.get("memory") or {})}
        known = {
            _normalize_text(item.get("text")).casefold()
            for key in ("decisions", "action_items")
            for item in memory.get(key, []) if isinstance(item, dict)
        }
        for raw in extracted.get("decisions", []) if isinstance(extracted.get("decisions"), list) else []:
            text = _normalize_text(raw)
            if text and text.casefold() not in known:
                memory["decisions"].append(_new_item(text, conv_id))
                known.add(text.casefold())
        action_items = extracted.get("action_items", [])
        for raw in action_items if isinstance(action_items, list) else []:
            data = raw if isinstance(raw, dict) else {"text": raw}
            text = _normalize_text(data.get("text"))
            if text and text.casefold() not in known:
                memory["action_items"].append(_new_item(
                    text, conv_id,
                    owner=_normalize_text(data.get("owner")),
                    due_date=_normalize_text(data.get("due_date")),
                ))
                known.add(text.casefold())
        summary = _normalize_text(extracted.get("summary"))
        if summary:
            memory["summary"] = summary
        memory["updated_at"] = datetime.now(timezone.utc).isoformat()
        await es.update(index=PROJECTS_INDEX, id=project_id, doc={"memory": memory}, refresh=True)
    except Exception as exc:
        logger.warning("[project_memory] 저장 실패(project_id=%s): %s", project_id, exc)
    finally:
        await es.close()
