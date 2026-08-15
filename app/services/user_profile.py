"""
services/user_profile.py – 사용자 프로필 관리

/remember 명령 실행 시:
1. user_profile에서 last_processed_at 조회
2. last_processed_at 이후 모든 대화방의 user 발화 추출
3. LLM으로 기존 프로필 + 새 대화 기반 프로필 업데이트
4. user_profile upsert (last_processed_at = now)

일반 채팅 query_llm 호출 시:
- user_profile 텍스트를 system_message 앞에 주입
"""
from datetime import datetime, timezone

from elasticsearch import NotFoundError

from services.db import get_es, HIST_INDEX
from logger import get_logger

logger = get_logger(__name__)

USER_PROFILE_INDEX = "user_profile"
USER_PROFILE_ID = "default"
MAX_PROFILE_LENGTH = 2000  # 최대 프로필 텍스트 길이
DEFAULT_RESPONSE_STYLE = "default"
RESPONSE_STYLE_INSTRUCTIONS = {
    "professional": "정제되고 정확한 전문적인 말투로 답하라. 핵심 용어를 명확히 쓰고 불필요한 수식은 피하라.",
    "friendly": "따뜻하고 친근한 말투로 답하라. 자연스럽게 대화하되 정보의 정확성은 유지하라.",
    "candid": "직설적이고 솔직하게 답하되 무례하지 않게 건설적인 제안과 근거를 함께 제시하라.",
    "quirky": "유쾌하고 상상력 있는 표현을 적절히 사용하되 핵심 정보와 정확성을 흐리지 마라.",
    "efficient": "간결하고 꾸밈없이 답하라. 결론과 실행 항목을 먼저 제시하고 중복 설명을 피하라.",
    "cynical": "약간 비꼬면서 비판적인 말투를 사용할 수 있으나, 사용자를 조롱하거나 정확성을 해치지 마라.",
    "royal_court": (
        "사용자를 왕으로 높여 예를 갖춘 신하가 보고하듯 답하라. 사용자를 '전하'로 호칭하되, "
        "과도한 아첨이나 장황한 고어체는 피하고 답변의 정확성, 명료성, 간결함을 유지하라."
    ),
}


async def ensure_user_profile_index():
    """user_profile 인덱스 생성 (없으면)"""
    es = get_es()
    try:
        if not await es.indices.exists(index=USER_PROFILE_INDEX):
            await es.indices.create(index=USER_PROFILE_INDEX, body={
                "mappings": {
                    "properties": {
                        "profile": {"type": "text"},
                        "nickname": {"type": "keyword"},
                        "response_style": {"type": "keyword"},
                        "last_processed_at": {"type": "date"},
                        "updated_at": {"type": "date"},
                    }
                }
            })
            logger.info("user_profile 인덱스 생성 완료")
    finally:
        await es.close()


async def get_user_profile() -> dict | None:
    """user_profile 조회. 없으면 None 반환"""
    es = get_es()
    try:
        res = await es.get(index=USER_PROFILE_INDEX, id=USER_PROFILE_ID)
        return res["_source"]
    except NotFoundError:
        return None
    except Exception as e:
        logger.warning("user_profile 조회 실패: %s", e)
        return None
    finally:
        await es.close()


async def get_profile_text() -> str:
    """시스템 프롬프트에 주입할 사용자 정보만 반환한다."""
    profile = await get_user_profile()
    return str(profile.get("profile") or "").strip() if profile else ""


async def get_response_style_instruction() -> str:
    """사용자 프로필 본문과 독립적으로 모든 채팅에 적용할 말투 지침을 반환한다."""
    profile = await get_user_profile()
    if not profile:
        return ""
    return RESPONSE_STYLE_INSTRUCTIONS.get(str(profile.get("response_style") or ""), "")


async def get_nickname() -> str:
    """프로필에서 닉네임/이름만 반환. 없으면 빈 문자열."""
    profile = await get_user_profile()
    if profile and profile.get("nickname"):
        return profile["nickname"]
    return ""


async def get_unprocessed_profile_conversations(last_processed_at: str | None) -> list[dict]:
    """마지막 분석 이후 변경된 일반 대화만 조회한다. 프로젝트 대화는 제외한다."""
    es = get_es()
    try:
        filters = []
        if last_processed_at:
            filters.append({"range": {"updated_at": {"gt": last_processed_at}}})
        query = {
            "bool": {
                "filter": filters,
                "must_not": [{"exists": {"field": "project_id"}}],
            }
        }

        res = await es.search(index=HIST_INDEX, body={
            "query": query,
            "sort": [{"updated_at": {"order": "asc"}}],
            "size": 200,
            "_source": ["conv_id", "title", "messages", "updated_at"],
        })
        return [h["_source"] for h in res["hits"]["hits"]]
    except Exception as e:
        logger.warning("미처리 대화 조회 실패: %s", e)
        return []
    finally:
        await es.close()


def _extract_user_messages(conversations: list[dict]) -> str:
    """대화 목록에서 user 발화만 추출하여 텍스트로 반환"""
    lines = []
    for conv in conversations:
        messages = conv.get("messages", [])
        for msg in messages:
            if msg.get("role") == "user":
                content = msg.get("content", "").strip()
                # 빈 메시지나 커맨드만 있는 경우 제외
                if not content or content.startswith("/"):
                    continue
                # 붙여넣기 마커 제거
                import re
                content = re.sub(r'«PASTE:.*?»[\s\S]*?«/PASTE»', '', content).strip()
                if content:
                    lines.append(content)
    return "\n".join(lines)


async def run_remember(current_conv_id: str = "") -> str:
    """
    /remember 실행:
    - 미처리 대화에서 user 발화 추출
    - LLM으로 프로필 업데이트
    - ES에 저장
    - 결과 메시지 반환
    """
    from services.llm import query_llm

    # 기존 프로필 조회
    existing = await get_user_profile()
    existing_profile = existing.get("profile", "") if existing else ""
    existing_response_style = existing.get("response_style", DEFAULT_RESPONSE_STYLE) if existing else DEFAULT_RESPONSE_STYLE
    last_processed_at = existing.get("last_processed_at") if existing else None

    # 미처리 대화 조회
    conversations = await get_unprocessed_profile_conversations(last_processed_at)

    # 현재 대화방은 /remember 메시지 포함되어 있을 수 있으므로 제외
    if current_conv_id:
        conversations = [c for c in conversations if c.get("conv_id") != current_conv_id]

    if not conversations:
        return "✅ 새로 처리할 대화가 없습니다.\n\n현재 프로필:\n" + (existing_profile or "_(프로필 없음)_")

    user_messages = _extract_user_messages(conversations)
    if not user_messages.strip():
        return "✅ 처리할 사용자 발화가 없습니다."

    # LLM으로 프로필 업데이트
    existing_nickname = existing.get("nickname", "") if existing else ""

    prompt = f"""아래는 사용자의 대화 기록에서 추출한 발화입니다.
이를 바탕으로 사용자에 대해 파악할 수 있는 중요한 정보를 정리해서 프로필을 작성해주세요.

규칙:
- 기존 프로필이 있으면 새 정보를 반영하여 업데이트 (기존 내용 중 여전히 유효한 것은 유지)
- 직업, 관심사, 진행 중인 프로젝트, 사용 기술, 선호 스타일 등 파악 가능한 것만 포함
- {MAX_PROFILE_LENGTH}자를 절대 넘지 말 것
- 추측이나 불확실한 내용은 포함하지 말 것
- 자연스러운 텍스트로 작성 (JSON, 마크다운 헤더 불필요)
- 첫 줄에 반드시 «NICKNAME:이름또는닉네임» 형태로 사용자의 이름이나 닉네임을 적어라 (대화에서 파악 가능한 경우만. 파악 불가하면 «NICKNAME:» 으로 비워둬라). 기존 닉네임이 있고 변경할 이유가 없으면 그대로 유지해라.
- 두 번째 줄부터 프로필 본문을 작성해라.

기존 프로필:
{existing_profile or "없음"}

기존 닉네임: {existing_nickname or "없음"}

새 대화 발화:
{user_messages[:8000]}

출력 (첫 줄 «NICKNAME:...» + 프로필):"""

    try:
        updated_profile = await query_llm(
            prompt, [], format_instruction_override="", use_tools=False, reasoning=False,
            call_reason="user_profile_update",
        )
        updated_profile = updated_profile.strip()[:MAX_PROFILE_LENGTH]
    except Exception as e:
        logger.error("프로필 LLM 업데이트 실패: %s", e)
        return f"❌ 프로필 업데이트 중 오류 발생: {e}"

    # 닉네임 파싱
    import re
    nickname = existing_nickname
    nick_match = re.match(r'«NICKNAME:(.*?)»', updated_profile)
    if nick_match:
        nickname = nick_match.group(1).strip()
        updated_profile = updated_profile[nick_match.end():].strip()

    # ES 저장
    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    es = get_es()
    try:
        await es.index(
            index=USER_PROFILE_INDEX,
            id=USER_PROFILE_ID,
            document={
                "profile": updated_profile,
                "nickname": nickname,
                "response_style": existing_response_style,
                "last_processed_at": now,
                "updated_at": now,
            },
            refresh=True,
        )
        logger.info("user_profile 업데이트 완료 (대화 %d개 처리)", len(conversations))
    except Exception as e:
        logger.error("user_profile 저장 실패: %s", e)
        return f"❌ 프로필 저장 중 오류 발생: {e}"
    finally:
        await es.close()

    return f"✅ 프로필 업데이트 완료 ({len(conversations)}개 대화방 처리)\n\n{updated_profile}"
