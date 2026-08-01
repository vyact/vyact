"""
services/conv_summary.py – 대화방 요약(conv_summary) / 첨부파일 요약(project_summary) 관리

핵심 아이디어: 별도 LLM 호출을 추가하지 않고, 어차피 매 턴 생성하는 답변 안에
숨김 태그(<conv_summary>, <project_summary>)로 요약을 같이 뽑아낸다.
- <conv_summary>: 매 턴 갱신되는 대화 흐름 요약 (이전 요약 + 이번 턴을 반영해 증분 갱신)
- <project_summary>: 이번 턴에 zip/파일이 새로 첨부됐을 때만 요청 — 그 첨부 배치에 대한 개요

사용자에게 보이는 답변에서는 이 태그들을 제거하고, 파싱한 값만 rag_history 문서에 저장한다.
SummaryModal이 GET /history/{conv_id}/summary로 조회하는 값이 바로 이거다.
"""
import re

from services.db import HIST_INDEX, get_es
from logger import get_logger

logger = get_logger(__name__)

CONV_SUMMARY_TAG_RE = re.compile(r"<conv_summary>([\s\S]*?)</conv_summary>", re.IGNORECASE)
PROJECT_SUMMARY_TAG_RE = re.compile(r"<project_summary>([\s\S]*?)</project_summary>", re.IGNORECASE)

HIDDEN_STREAM_TAG_PREFIXES = (
    "<conv_summary",
    "<project_summary",
    "<project_memory",
)


class HiddenMetadataStreamFilter:
    """Keep trailing internal metadata tags out of the user-visible token stream."""

    def __init__(self) -> None:
        self._pending = ""
        self._hidden = False

    def feed(self, text: str) -> str:
        if self._hidden or not text:
            return ""

        combined = self._pending + text
        lowered = combined.lower()
        tag_indexes = [
            index for prefix in HIDDEN_STREAM_TAG_PREFIXES
            if (index := lowered.find(prefix)) >= 0
        ]
        if tag_indexes:
            self._hidden = True
            self._pending = ""
            return combined[:min(tag_indexes)]

        retained_length = 0
        for length in range(1, min(len(combined), max(map(len, HIDDEN_STREAM_TAG_PREFIXES))) + 1):
            suffix = lowered[-length:]
            if any(prefix.startswith(suffix) for prefix in HIDDEN_STREAM_TAG_PREFIXES):
                retained_length = length

        if retained_length:
            visible = combined[:-retained_length]
            self._pending = combined[-retained_length:]
            return visible

        self._pending = ""
        return combined

    def finish(self) -> str:
        if self._hidden:
            return ""
        pending, self._pending = self._pending, ""
        return pending


def build_summary_instruction(
        prior_conv_summary: str, request_project_summary: bool, project_memory: dict | None = None,
) -> str:
    """system_prompt에 덧붙일 숨김 태그 생성 지시문. 사용자에게 안 보이는 내부 지시라
    followups처럼 답변 맨 끝에 태그로만 출력하게 한다.

    긴 답변(예: 대량 첨부 파일 전체 리뷰)일수록 모델이 맨 앞의 지시를 "잊고" 태그 없이
    끝내버리는 경우가 있어, (1) 필수임을 여러 번 강한 어조로 반복하고 (2) 매 턴 갱신되는
    conv_summary는 길이를 짧게 못박아 신뢰성을 높이되, project_summary(첨부 요약)는 반대로
    분량을 고정하지 않고 첨부 규모에 맞게 늘어나도록 둬서 대량 첨부 시에도 쓸모 있는 요약이
    남게 하며 (3) 지시 마지막에도 한 번 더 되짚어 recency를 살린다.
    """
    parts = [
        "\n\n---\n"
        "## 답변 본문 규칙 (중요)\n"
        "이 규칙은 사용자의 요청 때문에 답변 본문이 사실상 비게 되는 경우에만 적용합니다.\n"
        "예를 들어 \"분석 내용은 알려줄 필요 없다\", \"요약하지 마라\", \"결과만 저장해라\"처럼 "
        "실질적으로 답변 본문을 작성하지 않게 되는 요청이 이에 해당합니다.\n"
        "이 경우에는 답변 본문을 완전히 비워두지 말고, 반드시 1~2문장의 짧은 확인 답변 "
        "(예: \"네, 처리했습니다.\", \"완료되었습니다.\" 등 짧은 한 문장)을 먼저 작성하세요.\n"
        "반대로 일반적인 질문처럼 정상적인 답변 본문을 작성하는 경우에는 이 규칙을 적용하지 말고, "
        "확인 답변을 추가하지 마세요.\n\n"
        "## 내부 요약 태그 (사용자에게 언급하지 말 것) — 절대 생략 금지 (필수)\n"
        "아래 태그는 답변 본문의 길이·주제·난이도와 무관하게 매 응답마다 반드시 출력해야 하는 "
        "필수 항목입니다. 답변이 아무리 길어지더라도(예: 파일 수백 개 전체 코드 리뷰, 방대한 분석 등) "
        "본문을 다 쓴 뒤 절대 그냥 끝내지 말고, 마지막에 이 태그를 빠뜨리지 않고 출력하세요.\n"
        "위 답변 본문을 모두 작성한 뒤, 마지막 줄에 다음 형식으로 대화 요약을 갱신해서 출력하세요.\n"
        "이 요약은 다음 요청에서 이전 대화를 복원하기 위한 용도입니다.\n"
        "사용자의 요구사항, 중요한 결정사항, 진행 상태, 앞으로 이어질 작업을 우선적으로 포함하세요.\n"
        "불필요한 내용은 생략하고 핵심만 유지하며, 아무리 답변 본문이 길었더라도 요약 자체는 "
        "**최대 3~4문장 이내**로 짧게 압축하세요(본문 분량과 요약 분량은 비례하지 않습니다. "
        "짧게 쓰는 것이 오히려 올바른 실행입니다).\n"
        "<conv_summary>...</conv_summary>\n"
    ]
    if prior_conv_summary:
        parts.append(
            f"직전까지의 요약은 다음과 같습니다. 이걸 기반으로 이번 턴 내용을 반영해 갱신하세요 "
            f"(완전히 새로 쓰지 말고 이어서 갱신):\n\"{prior_conv_summary}\"\n"
        )
    if request_project_summary:
        parts.append(
            "이번 턴에 파일이 새로 첨부되었습니다. <conv_summary> 바로 다음 줄에 아래 태그도 "
            "반드시 추가하세요(이것도 생략 금지):\n"
            "<project_summary>이번에 첨부된 파일들의 디렉토리 구조와 핵심 파일 역할을 요약하세요. "
            "분량은 고정하지 않습니다 — 파일 몇 개짜리 단순 첨부면 2~3문장이면 충분하지만, "
            "파일 수가 많거나 구조가 복잡한 프로젝트라면 주요 디렉토리/모듈별로 나눠 "
            "충분히 상세하게(필요하면 문단을 나눠서) 작성하세요. 짧게 뭉뚱그리는 것보다 "
            "나중에 이 요약만 보고도 프로젝트 구조를 파악할 수 있는 게 더 중요합니다."
            "</project_summary>\n"
        )
    if project_memory is not None:
        from services.project_memory import build_project_memory_instruction
        parts.append(build_project_memory_instruction(project_memory))
    parts.append(
        "이 태그들은 화면에 표시되지 않고 내부 저장용이므로, 답변 본문에서 태그 내용을 다시 언급하거나 "
        "사용자에게 \"요약을 남겼다\"는 식으로 말하지 마세요.\n"
        "※ 마지막으로 다시 강조합니다: 답변 본문을 아무리 길게 작성했더라도, 그것으로 끝내지 말고 "
        "반드시 <conv_summary> 태그"
        + ("(및 <project_summary> 태그)" if request_project_summary else "")
        + "를 짧게라도 남긴 뒤에 응답을 마치세요. 이 태그 없이 끝나는 응답은 오류로 간주됩니다."
    )
    return "".join(parts)


def extract_summary_tags(answer: str) -> tuple[str, str | None, str | None]:
    """답변 텍스트에서 <conv_summary>/<project_summary> 태그를 추출하고, 제거된 본문을 반환.

    반환값: (clean_answer, conv_summary | None, project_summary | None)
    """
    conv_summary = None
    project_summary = None

    m = CONV_SUMMARY_TAG_RE.search(answer)
    if m:
        conv_summary = m.group(1).strip()
        answer = CONV_SUMMARY_TAG_RE.sub("", answer)

    m = PROJECT_SUMMARY_TAG_RE.search(answer)
    if m:
        project_summary = m.group(1).strip()
        answer = PROJECT_SUMMARY_TAG_RE.sub("", answer)

    clean_answer = answer.strip()
    # 일부 소형 모델은 답변 본문 없이 내부 요약 태그만 출력한다. 태그를 무조건
    # 제거하면 SSE에는 토큰이 있었어도 최종 answer가 빈 문자열이 되어 UI가 빈
    # 메시지를 표시한다. 이 경우 요약 내용을 사용자 응답으로 보존한다.
    if not clean_answer and conv_summary:
        clean_answer = conv_summary

    return clean_answer, conv_summary, project_summary


async def get_prior_conv_summary(conv_id: str) -> str:
    """이 대화방에 저장된 이전 conv_summary 조회 (없으면 빈 문자열)."""
    if not conv_id:
        return ""
    es = get_es()
    try:
        res = await es.get(index=HIST_INDEX, id=conv_id)
        return res["_source"].get("conv_summary", "") or ""
    except Exception:
        return ""
    finally:
        await es.close()


async def save_conv_summary(conv_id: str, conv_summary: str) -> None:
    """conv_summary를 대화방 문서에 갱신 저장 (messages는 건드리지 않음).

    upsert 사용: 정상 흐름상 save_conversation이 먼저 문서를 만든 뒤 호출되지만,
    호출 순서가 꼬이거나 문서가 아직 안 만들어진 예외 상황에서도 실패하지 않도록 방어.
    """
    if not conv_id or not conv_summary:
        return
    es = get_es()
    try:
        await es.update(
            index=HIST_INDEX, id=conv_id,
            body={
                "doc": {"conv_summary": conv_summary},
                "upsert": {"conv_id": conv_id, "conv_summary": conv_summary, "messages": []},
            },
            retry_on_conflict=3,
        )
    except Exception as e:
        logger.warning("[conv_summary] 저장 실패 (conv_id=%s): %s", conv_id, e)
    finally:
        await es.close()


async def append_attachment_summary(
        conv_id: str, project_summary: str | None, source_name: str, file_count: int, batch_id: str,
) -> None:
    """첨부(zip/파일) 요약을 attachment_summaries 배열에 추가 (덮어쓰지 않고 append).

    project_summary는 LLM이 <project_summary> 태그로 만들어준 설명인데, 답변이 너무 길거나
    복잡한 요청(예: 파일 수백 개짜리 전체 코드 리뷰)에서는 LLM이 이 태그 지시를 놓치는 경우가 있다.
    그렇다고 "몇 개 파일이 언제 첨부됐는지"까지 통째로 버리면 안 되므로, 요약 텍스트가 없어도
    배치 메타정보(source_name/file_count/batch_id)는 항상 기록하고 요약만 폴백 문구로 채운다.
    """
    if not conv_id:
        return
    from datetime import datetime, timezone
    entry = {
        "batch_id": batch_id,
        "attached_at": datetime.now(timezone.utc).isoformat(),
        "source_name": source_name,
        "file_count": file_count,
        "summary": project_summary or "(요약 생성 실패 — 첨부 정보만 기록됨)",
    }
    es = get_es()
    try:
        try:
            doc = await es.get(index=HIST_INDEX, id=conv_id)
            existing = doc["_source"].get("attachment_summaries", []) or []
        except Exception:
            existing = []
        existing.append(entry)
        await es.update(
            index=HIST_INDEX, id=conv_id,
            body={
                "doc": {"attachment_summaries": existing},
                "upsert": {"conv_id": conv_id, "attachment_summaries": existing, "messages": []},
            },
            retry_on_conflict=3,
        )
    except Exception as e:
        logger.warning("[conv_summary] 첨부 요약 저장 실패 (conv_id=%s): %s", conv_id, e)
    finally:
        await es.close()
