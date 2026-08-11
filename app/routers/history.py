"""
routers/history.py – 대화 히스토리
"""
from fastapi import APIRouter, HTTPException

from agent import list_conversations, get_conversation, delete_conversation, rename_conversation
from services.history import list_favorite_conversations, set_conversation_favorite

router = APIRouter()


@router.get("/history")
async def get_history(
    limit: int = 20, offset: int = 0, project_id: str | None = None,
    exclude_project: bool = False,
):
    # {conversations, total} 반환 — 프론트가 20씩 페이징 조회한다.
    result = await list_conversations(
        size=limit, offset=offset, project_id=project_id,
        exclude_project=exclude_project,
    )
    result["favorite_conversations"] = await list_favorite_conversations()
    return result


@router.get("/history/{conv_id}")
async def get_one(conv_id: str):
    conv = await get_conversation(conv_id)
    if not conv:
        raise HTTPException(404)
    return conv


@router.get("/history/{conv_id}/summary")
async def get_summary(conv_id: str):
    """
    대화방 요약 조회.
    conv_summary: 대화 흐름 요약 (매 턴 갱신되는 단일 문자열)
    attachment_summaries: 첨부(zip/파일)별 요약 배열

    ⚠ 두 필드 모두 아직 생성 로직이 붙기 전에는 항상 비어있다.
    (다음 단계: 응답 생성 시 <conv_summary>/<project_summary> 숨김 태그 파싱해서
    이 문서에 채워 넣는 작업이 필요 — 지금은 조회 API만 먼저 준비)
    """
    conv = await get_conversation(conv_id)
    if not conv:
        raise HTTPException(404)
    return {
        "conv_id": conv_id,
        "conv_summary": conv.get("conv_summary", ""),
        "attachment_summaries": conv.get("attachment_summaries", []),
    }


@router.delete("/history")
async def delete_all():
    from services.history import delete_all_conversations
    await delete_all_conversations()
    return {"ok": True}


@router.delete("/history/{conv_id}")
async def delete_one(conv_id: str):
    await delete_conversation(conv_id)
    return {"ok": True}


@router.delete("/history/{conv_id}/messages")
async def clear_messages(conv_id: str):
    """방과 제목은 유지하고 메시지만 전부 삭제."""
    from services.history import clear_conversation_messages
    await clear_conversation_messages(conv_id)
    return {"ok": True}


@router.patch("/history/{conv_id}/title")
async def rename_one(conv_id: str, body: dict):
    title = body.get("title", "").strip()
    if not title:
        raise HTTPException(400, "제목을 입력하세요.")
    await rename_conversation(conv_id, title)
    return {"ok": True}


@router.patch("/history/{conv_id}/project")
async def set_project(conv_id: str, body: dict):
    from services.history import set_conversation_project
    await set_conversation_project(conv_id, body.get("project_id") or None)
    return {"ok": True}


@router.patch("/history/{conv_id}/favorite")
async def set_favorite(conv_id: str, body: dict):
    await set_conversation_favorite(conv_id, bool(body.get("is_favorite")))
    return {"ok": True}
