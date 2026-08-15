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
        "\n\n## 프로젝트 메모리 갱신 (내부 저장용, 사용자에게 언급하지 말 것)\n"
        "현재 프로젝트 메모리는 다음과 같습니다. 이번 사용자 발화와 답변에서 명시적으로 확인되는 "
        "내용만 반영하세요. 추측하거나 일반적인 조언을 결정/할 일로 만들지 마세요.\n"
        f"현재 메모리: {current}\n"
        "답변 맨 끝에 아래 JSON 태그를 반드시 한 번 출력하세요. summary는 기존 핵심 맥락을 유지하면서 "
        "이번 턴을 반영한 4문장 이내의 프로젝트 현황입니다. decisions와 action_items에는 이번 턴에서 "
        "새로 확정된 항목만 넣으세요. 없으면 빈 배열을 사용하세요. due_date는 명시된 경우에만 ISO 8601 "
        "날짜로 쓰고, owner도 명시된 경우에만 쓰세요.\n"
        '<project_memory>{"summary":"...","decisions":["..."],'
        '"action_items":[{"text":"...","owner":"","due_date":""}]}</project_memory>\n'
        "JSON 이외의 텍스트를 태그 안에 넣지 마세요."
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
