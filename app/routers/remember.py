"""
routers/remember.py – /remember SSE 스트리밍
"""
import json
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from logger import get_logger
from error_responses import public_error_payload
from prompts.language import get_language_label
from services.db import get_es
from services.user_profile import (
    DEFAULT_RESPONSE_STYLE,
    RESPONSE_STYLE_INSTRUCTIONS,
    get_unprocessed_profile_conversations,
    get_user_profile,
    USER_PROFILE_INDEX,
    USER_PROFILE_ID,
)

logger = get_logger(__name__)

router = APIRouter()


class RememberRequest(BaseModel):
    conv_id: str = ""
    user_timestamp: str = ""
    max_length: int = 200
    language: str = "en"


@router.get("/user-profile")
async def get_user_profile_api():
    """현재 저장된 user_profile 조회"""
    profile = await get_user_profile()
    if not profile:
        return {"profile": None, "nickname": "", "response_style": DEFAULT_RESPONSE_STYLE}
    return {
        "profile": profile.get("profile"),
        "nickname": profile.get("nickname", ""),
        "response_style": profile.get("response_style", DEFAULT_RESPONSE_STYLE),
        "updated_at": profile.get("updated_at"),
    }


class ProfileUpdateRequest(BaseModel):
    profile: str | None = None
    nickname: str | None = None
    response_style: str | None = None
    analysis_cursor: datetime | None = None
    max_length: int | None = None


@router.put("/user-profile")
async def update_user_profile_api(req: ProfileUpdateRequest):
    """프로필 직접 편집 저장 (last_processed_at 보존)"""
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    doc: dict = {"updated_at": now}
    if req.profile is not None:
        profile = req.profile.strip()
        if req.max_length is not None:
            max_length = max(100, min(req.max_length, 1000))
            if len(profile) > max_length:
                raise HTTPException(400, "Profile exceeds the selected character limit.")
        doc["profile"] = profile
    if req.nickname is not None:
        doc["nickname"] = req.nickname.strip()
    if req.response_style is not None:
        response_style = req.response_style.strip()
        if response_style != DEFAULT_RESPONSE_STYLE and response_style not in RESPONSE_STYLE_INSTRUCTIONS:
            raise HTTPException(400, "Unsupported response style.")
        doc["response_style"] = response_style
    if req.analysis_cursor is not None:
        doc["last_processed_at"] = req.analysis_cursor.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    es = get_es()
    try:
        await es.update(
            index=USER_PROFILE_INDEX,
            id=USER_PROFILE_ID,
            body={"doc": doc, "doc_as_upsert": True},
            refresh=True,
        )
        return {"ok": True, "updated_at": now}
    finally:
        await es.close()


def sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/remember")
async def remember(req: RememberRequest):
    async def stream():
        import re as _re
        from services.llm.core import collect_llm_stream, query_llm
        max_len = max(100, min(req.max_length, 1000))
        profile_language = get_language_label(req.language)

        try:
            # 1. 기존 프로필 조회
            yield sse("status", {"message": "프로필 조회 중..."})
            existing = await get_user_profile()
            existing_profile = existing.get("profile", "") if existing else ""
            last_processed_at = existing.get("last_processed_at") if existing else None
            logger.info("[remember] last_processed_at=%s", last_processed_at)

            # 2. 미처리 일반 대화 목록 조회 (프로젝트 대화 제외)
            yield sse("status", {"message": "미처리 대화 조회 중..."})
            conversations = await get_unprocessed_profile_conversations(last_processed_at)
            logger.info("[remember] 조회된 일반 대화방 %d개: %s", len(conversations),
                        [(c.get("conv_id", "")[:8], c.get("updated_at", "")) for c in conversations])

            total = len(conversations)
            if total == 0:
                yield sse("done", {
                    "profile": existing_profile,
                    "message": "새로 처리할 대화가 없습니다.",
                    "processed": 0,
                })
                return

            yield sse("status", {"message": f"{total}개 대화방 발견"})

            # 3. 대화방별 user 발화 추출
            all_user_messages = []
            for i, conv in enumerate(conversations, 1):
                title = conv.get("title", "대화")[:20]
                yield sse("progress", {"current": i, "total": total, "title": title})

                messages = conv.get("messages", [])
                for msg in messages:
                    if msg.get("role") == "user":
                        content = msg.get("content", "").strip()
                        if not content or content.startswith("/"):
                            continue
                        content = _re.sub(r'«PASTE:.*?»[\s\S]*?«/PASTE»', '', content).strip()
                        if content:
                            all_user_messages.append(content)

            if not all_user_messages:
                yield sse("done", {
                    "profile": existing_profile,
                    "message": "처리할 사용자 발화가 없습니다.",
                    "processed": total,
                })
                return

            # 4. LLM으로 프로필 업데이트
            yield sse("status", {"message": "AI가 프로필을 분석 중..."})
            user_text = "\n".join(all_user_messages)

            prompt = f"""아래는 사용자의 대화 기록에서 추출한 발화입니다.
이를 바탕으로 사용자에 대해 파악할 수 있는 중요한 정보를 정리해서 프로필을 작성해주세요.

규칙:
- 기존 프로필이 있으면 새 정보를 반영하여 업데이트 (기존 내용 중 여전히 유효한 것은 유지)
- 직업, 관심사, 진행 중인 프로젝트, 사용 기술, 선호 스타일 등 파악 가능한 것만 포함
- {max_len}자를 절대 넘지 말 것
- 프로필은 반드시 {profile_language}로 작성
- 추측이나 불확실한 내용은 포함하지 말 것
- 자연스러운 텍스트로 작성 (JSON, 마크다운 헤더 불필요)

기존 프로필:
{existing_profile or "없음"}

새 대화 발화:
{user_text[:8000]}

업데이트된 프로필만 출력하세요:"""

            updated_profile, _ = await collect_llm_stream(
                prompt, [], format_instruction_override="", inject_user_profile=False, use_tools=False, reasoning=False,
                call_reason="user_profile_update",
            )
            updated_profile = updated_profile.strip()[:max_len]

            # 분석 결과는 미리보기로만 반환한다. 사용자가 반영할 때 PUT /user-profile이
            # 프로필과 분석 기준 시점을 함께 저장한다.
            analysis_cursor = max(
                (str(conversation.get("updated_at") or "") for conversation in conversations),
                default="",
            )
            yield sse("done", {
                "profile": updated_profile,
                "message": f"{total}개 대화방 처리 완료",
                "processed": total,
                "analysis_cursor": analysis_cursor,
            })

        except Exception as e:
            logger.exception("remember 처리 오류")
            yield sse("error", public_error_payload("profile_analysis_failed"))

    return StreamingResponse(stream(), media_type="text/event-stream")
