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

CONV_TITLE_TAG_RE = re.compile(r"<conv_title>([\s\S]*?)</conv_title>", re.IGNORECASE)
CONV_SUMMARY_TAG_RE = re.compile(r"<conv_summary>([\s\S]*?)</conv_summary>", re.IGNORECASE)
PROJECT_SUMMARY_TAG_RE = re.compile(r"<project_summary>([\s\S]*?)</project_summary>", re.IGNORECASE)
TOOL_CALL_TAG_RE = re.compile(r"<tool_call(?:\s[^>]*)?>[\s\S]*?(?:</tool_call>|$)", re.IGNORECASE)

HIDDEN_STREAM_TAG_PREFIXES = (
    "<conv_title",
    "<conv_summary",
    "<project_summary",
    "<project_memory",
    "<tool_call",
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

    conv_summary는 짧게 제한하고 project_summary는 첨부 규모에 맞춰 작성하게 한다.
    필수 형식과 사용자에게 숨겨지는 메타데이터라는 점만 명확하게 전달한다.
    """
    parts = [
        "\n\n---\n"
        "## Visible response\n"
        "Never leave the visible response empty. If the request produces no visible result, confirm completion in 1–2 short sentences. "
        "Do not add a separate confirmation to a normal answer.\n\n"
        "## Internal summary tag (required; never mention it to the user)\n"
        "After the visible response, end every response with an updated conversation summary in this format. "
        "It restores context in the next request.\n"
        "Prioritize user requirements, important decisions, current progress, and next steps. "
        "Regardless of response length, omit incidental details and keep it to at most 3–4 sentences.\n"
        "<conv_summary>...</conv_summary>\n"
    ]
    if not prior_conv_summary:
        parts.append(
            "For the first response only, put a short sidebar title immediately before <conv_summary>. "
            "Summarize the topic naturally in about 20 characters without copying the user's text or including UI markers such as PASTE:\n"
            "<conv_title>Short conversation title</conv_title>\n"
        )
    if prior_conv_summary:
        parts.append(
            f"Update the following prior summary with this turn instead of rewriting it from scratch:\n"
            f"\"{prior_conv_summary}\"\n"
        )
    if request_project_summary:
        parts.append(
            "Files were attached in this turn. Add this tag immediately after <conv_summary>:\n"
            "<project_summary>Summarize the attached directory structure and the role of key files. "
            "Use 2–3 sentences for a few simple files. For a large or complex project, provide enough detail by major directory or module, "
            "using separate paragraphs if helpful, so the project can be understood from this summary alone."
            "</project_summary>\n"
        )
    if project_memory is not None:
        from services.project_memory import build_project_memory_instruction
        parts.append(build_project_memory_instruction(project_memory))
    parts.append(
        "These tags are hidden internal metadata. Do not mention their content or creation in the visible response. "
        + ("End with <conv_summary> followed by <project_summary>." if request_project_summary
           else "End with <conv_summary>.")
    )
    return "".join(parts)


def extract_summary_tags(answer: str) -> tuple[str, str | None, str | None, str | None]:
    """답변 텍스트에서 <conv_summary>/<project_summary> 태그를 추출하고, 제거된 본문을 반환.

    반환값: (clean_answer, conv_summary | None, project_summary | None, conv_title | None)
    """
    conv_summary = None
    project_summary = None
    conv_title = None

    # 일부 로컬 모델은 tool 반복 한도 이후 내부 호출 문법을 일반 답변 텍스트로
    # 내보낸다. 실행되지 않는 내부 마크업이므로 히스토리와 UI에서 제거한다.
    answer = TOOL_CALL_TAG_RE.sub("", answer)

    title_match = CONV_TITLE_TAG_RE.search(answer)
    if title_match:
        conv_title = re.sub(r"\s+", " ", title_match.group(1)).strip()[:60] or None
        answer = CONV_TITLE_TAG_RE.sub("", answer)

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

    return clean_answer, conv_summary, project_summary, conv_title


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
