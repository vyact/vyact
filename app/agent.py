"""
agent.py – RAG 진입점 + services 모듈 re-export

app/services/
  db.py       – ES 클라이언트 / 인덱스 초기화
  indexer.py  – 문서 인덱싱 / 검색 / 통계
  llm.py      – LLM 쿼리 (Ollama / OpenAI / Gemini / Claude)
  history.py  – 대화 히스토리 CRUD
  prompts.py  – System Prompt CRUD + 캐시
"""
import asyncio
from pathlib import Path
from typing import Any

from services.request_context import current_user_question

# ── re-export (main.py 등에서 from agent import ... 유지) ──
from services.db import (
    ensure_index, index_default_system_prompt, get_es,
    _index_default_translator_prompt,
    _index_default_summarizer_prompt,
    _index_default_coding_prompt,
)
from services.indexer import index_documents, rag_search, memo_search, get_index_stats, knowledge_collection_search
from services.llm import query_llm, chat_stream_with_tools, collect_llm_stream, get_model_name, get_provider_config
from services.history import (
    save_conversation, create_conversation_stub, list_conversations,
    get_conversation, delete_conversation, rename_conversation,
)
from services.prompts import (
    load_prompts_cache, get_prompts_list, get_prompt_by_id,
    create_prompt, update_prompt, delete_prompt, reorder_prompts,
)
from logger import get_logger

logger = get_logger(__name__)


def _knowledge_inline_image_attachments(docs: list[dict], limit: int = 3) -> list[dict]:
    images: list[dict] = []
    seen_paths: set[str] = set()

    def add_images(image_list: list[dict]) -> bool:
        for image in reversed(image_list):
            path = image.get("path", "")
            if not path or path in seen_paths or not Path(path).is_file():
                continue
            images.append({"type": "image", "filename": image.get("filename", "image"), "path": path})
            seen_paths.add(path)
            if len(images) >= limit:
                return True
        return False

    for document in docs:
        messages = document.get("messages", [])
        if messages:
            for message in reversed(messages):
                if add_images(message.get("inline_images", [])):
                    return images
        elif add_images(document.get("inline_images", [])):
            return images
    return images


async def _gather_rag_only(question: str) -> list[dict]:
    """ES(RAG) 뉴스 검색 + 관련도 필터만 수행 (메모/extra_context 제외).

    rag_query_stream에서 "tool을 안 썼을 때만" 지연 호출하는 폴백용으로 분리했다.
    """
    RAG_SCORE_THRESHOLD = 0.35
    try:
        rag_docs = await rag_search(question, size=5)
    except Exception as e:
        logger.warning("[rag_query] RAG 검색 실패: %s", e)
        return []
    if not isinstance(rag_docs, list):
        return []

    before = len(rag_docs)
    rag_docs = [d for d in rag_docs
                if d.get("rerank_score") is None or d["rerank_score"] >= RAG_SCORE_THRESHOLD]
    if before != len(rag_docs):
        logger.info("[rag_query] 관련도 필터: RAG %d개 → %d개 (임계값 %.2f)",
                    before, len(rag_docs), RAG_SCORE_THRESHOLD)
    return rag_docs


async def _gather_docs(question: str, extra_context: list, skip_rag: bool = False, conv_id: str = "", knowledge_collection_id: str = "") -> list[dict]:
    """RAG(ES 문서) + 메모 + 첨부파일(conv_id 스코프) 검색 결과를 모아 docs로 반환.

    RAG/메모/첨부파일 검색은 (tool 판정과 무관하게) 프롬프트 context로 선주입한다.
    셋 다 LLM 호출 없이(임베딩/ES만) 병행 조회되므로 판정 비용이 들지 않는다.

    관련 없는 질문(예: "내 GitHub 저장소 목록")에 엉뚱한 뉴스가 딸려오지 않도록
    reranker 점수(rerank_score)가 임계값 미만인 RAG 문서는 버린다.

    skip_rag=True 이면 RAG/메모/첨부파일 검색을 모두 건너뛴다. (예: 이번 턴에 파일을
    막 첨부해서 답이 extra_context 안에서 나오는 경우 — 같은 내용을 또 검색할 필요 없음.)

    conv_id가 있으면 이 대화방에 이전에 첨부된 파일(zip/코드 등)의 청크를 임베딩
    검색해서 관련된 것만 추가한다 — 재첨부 없이도 이전 턴의 첨부 내용을 이어서 참조 가능.
    """
    if skip_rag:
        return list(extra_context)

    if knowledge_collection_id:
        collection_docs, _ = await knowledge_collection_search(knowledge_collection_id, question, size=8)
        return list(extra_context) + collection_docs

    from services.chat_file_index import has_chat_files, search_chat_files

    async def _gather_chat_files() -> list[dict]:
        if not conv_id:
            return []
        try:
            if not await has_chat_files(conv_id):
                logger.info("[chat_file_search] conv_id=%s 인덱싱된 첨부파일 없음(아직 인덱싱 중이거나 첨부 없음) — 스킵", conv_id)
                return []
            return await search_chat_files(conv_id, question)
        except Exception as e:
            logger.warning("[rag_query] 첨부파일 검색 실패: %s", e)
            return []

    rag_docs, memo_result, chat_file_docs = await asyncio.gather(
        _gather_rag_only(question),
        memo_search(question, size=3),
        _gather_chat_files(),
        return_exceptions=True,
    )
    rag_docs = rag_docs if isinstance(rag_docs, list) else []
    memo_docs = memo_result if isinstance(memo_result, list) else []
    chat_file_docs = chat_file_docs if isinstance(chat_file_docs, list) else []
    if isinstance(memo_result, Exception):
        logger.warning("[rag_query] 메모 검색 실패: %s", memo_result)

    return extra_context + rag_docs + memo_docs + chat_file_docs


async def rag_query(
        question: str,
        system_prompt: str = "",
        attachments: list = [],
        conversation_history: list = [],
        extra_context: list = [],
        skip_rag: bool = False,
        reasoning: bool = True,
        conv_id: str = "",
        conversation_summary: str = "",
        call_reason: str = "chat",
        knowledge_collection_id: str = "",
) -> dict[str, Any]:
    """RAG 쿼리 실행 및 응답 (논스트리밍)."""
    current_user_question.set(question)
    docs = await _gather_docs(question, extra_context, skip_rag=skip_rag, conv_id=conv_id, knowledge_collection_id=knowledge_collection_id)
    if knowledge_collection_id:
        _, collection_instruction = await knowledge_collection_search(knowledge_collection_id, question, size=1)
        if collection_instruction:
            system_prompt = f"{system_prompt}\n\n[지식 컬렉션 지침]\n{collection_instruction}" if system_prompt else collection_instruction
    answer = await query_llm(question, docs, system_prompt, [*attachments, *_knowledge_inline_image_attachments(docs)], conversation_history,
                             reasoning=reasoning, conversation_summary=conversation_summary, call_reason=call_reason)
    return {
        "answer": answer.strip(),
        "response_type": "simple",
        "sources": docs,
        "model": await get_model_name(),
    }


async def rag_query_stream(
        question: str,
        system_prompt: str = "",
        attachments: list = [],
        conversation_history: list = [],
        extra_context: list = [],
        skip_rag: bool = False,
        reasoning: bool = True,
        conv_id: str = "",
        conversation_summary: str = "",
        format_instruction_override: str | None = None,
        call_reason: str = "chat",
        knowledge_collection_id: str = "",
):
    """일반 채팅 스트리밍. tool 진행 + 최종 답변 토큰을 이벤트로 흘린다.

    yield 형식: {"type": "tool", "phase": "start"/"end", "name": ..., "sources"?: [...]}
                {"type": "token", "text": ...}
                {"type": "stats", "prompt_eval_count", "prompt_eval_duration",
                                  "eval_count", "eval_duration", "total_duration"}  (ollama만 해당, 없으면 미발생)
                {"type": "final", "result": {..., "sources": docs+tool_sources, "stats": {...} | None}}

    tool(예: 네이버 뉴스 검색)이 기사 등 sources를 반환하면 "tool" 이벤트의
    phase="end"에 "sources"로 실려온다. 이걸 모아서 최종 sources에 합쳐야
    "참고" 목록에 tool이 실제로 가져온 기사가 표시된다.

    ES(RAG) 뉴스 검색을 처음부터 하지 않는 지연 조회는 ollama에서만 동작한다
    (chat_stream_with_tools의 post_tool_docs 훅이 ollama 경로에만 구현돼 있음).
    다른 provider(OpenAI/Gemini/Claude)는 회귀 방지를 위해 기존처럼 RAG+메모를
    tool 판정 전에 먼저(병렬로) 조회한다.

    ollama 경로에서는 tool 판정이 끝난 뒤에야 메모/RAG/첨부파일을 조회한다:
    - tool이 sources를 가져왔으면(예: 네이버 뉴스 검색 성공) → 메모+첨부파일만 조회
      (메모/첨부파일은 사용자 개인 데이터라 tool 성공 여부와 무관하게 항상 필요하지만, 뉴스 RAG는
      tool이 이미 최신 걸 가져왔으니 굳이 오래된 인덱스를 또 볼 필요가 없다)
    - tool을 안 썼거나 결과가 없었으면 → 메모 + 뉴스 RAG + 첨부파일을 원래처럼 asyncio.gather로
      동시에 조회해서 보충한다.
    """
    provider_config = await get_provider_config()
    current_user_question.set(question)
    is_ollama = provider_config.get("type") == "ollama"

    collection_instruction = ""
    collection_docs: list[dict] = []
    if knowledge_collection_id:
        yield {"type": "tool", "phase": "start", "name": "search_knowledge_collection"}
        collection_docs, collection_instruction = await knowledge_collection_search(knowledge_collection_id, question, size=8)
        yield {"type": "tool", "phase": "end", "name": "search_knowledge_collection"}
        docs = list(extra_context) + collection_docs
    elif skip_rag:
        docs = list(extra_context)
    elif is_ollama:
        docs = list(extra_context)  # 메모/RAG/첨부파일은 tool 판정 이후로 미룸
    else:
        docs = await _gather_docs(question, extra_context, skip_rag=False, conv_id=conv_id)

    parts: list[str] = []
    stats: dict | None = None
    tool_sources: list[dict] = []
    post_docs: list[dict] = []

    async def _gather_chat_files_for_stream() -> list[dict]:
        if not conv_id:
            return []
        from services.chat_file_index import has_chat_files, search_chat_files
        try:
            if not await has_chat_files(conv_id):
                return []
            return await search_chat_files(conv_id, question)
        except Exception as e:
            logger.warning("[rag_query] 첨부파일 검색 실패: %s", e)
            return []

    async def _post_tool_docs(tool_got_sources: bool) -> list[dict]:
        if knowledge_collection_id:
            return collection_docs
        if tool_got_sources:
            # tool이 이미 최신 뉴스를 가져왔으므로 메모+첨부파일만 보충
            memo_result, chat_file_result = await asyncio.gather(
                memo_search(question, size=3), _gather_chat_files_for_stream(),
                return_exceptions=True,
            )
            memo_docs = memo_result if isinstance(memo_result, list) else []
            chat_file_docs = chat_file_result if isinstance(chat_file_result, list) else []
            docs_found = memo_docs + chat_file_docs
        else:
            # tool을 안 썼거나 실패 — 메모 + 뉴스 RAG + 첨부파일을 병렬로 조회
            memo_result, rag_result, chat_file_result = await asyncio.gather(
                memo_search(question, size=3), _gather_rag_only(question),
                _gather_chat_files_for_stream(),
                return_exceptions=True,
            )
            memo_docs = memo_result if isinstance(memo_result, list) else []
            rag_docs = rag_result if isinstance(rag_result, list) else []
            chat_file_docs = chat_file_result if isinstance(chat_file_result, list) else []
            if isinstance(memo_result, Exception):
                logger.warning("[rag_query] 메모 검색 실패: %s", memo_result)
            docs_found = memo_docs + rag_docs + chat_file_docs
        # reset(늦은 tool 호출) 시 재호출될 수 있으므로 extend가 아니라 교체 —
        # 마지막 호출 결과만 유효하다 (중복 누적 방지)
        post_docs.clear()
        post_docs.extend(docs_found)
        return docs_found

    if collection_instruction:
        system_prompt = f"{system_prompt}\n\n[지식 컬렉션 지침]\n{collection_instruction}" if system_prompt else collection_instruction

    async for ev in chat_stream_with_tools(
            question, docs, system_prompt, [*attachments, *_knowledge_inline_image_attachments(docs)], conversation_history,
            reasoning=reasoning,
            format_instruction_override=format_instruction_override,
            conversation_summary=conversation_summary,
            # 컬렉션은 위에서 검색한 결과를 첫 프롬프트에 이미 넣었으므로,
            # 지연 RAG 보충을 다시 실행하면 같은 문서가 중복 주입된다.
            post_tool_docs=_post_tool_docs if (is_ollama and not skip_rag and not knowledge_collection_id) else None,
            call_reason=call_reason,
    ):
        if ev.get("type") == "token":
            parts.append(ev.get("text", ""))
            yield ev
        elif ev.get("type") == "reset":
            # 판정 스트림 relay 후 뒤늦게 tool 호출이 나온 케이스 —
            # 지금까지 모은 답변 조각을 버리고 프론트에도 초기화를 지시한다
            parts.clear()
            yield ev
        elif ev.get("type") == "tool":
            if ev.get("phase") == "end" and ev.get("sources"):
                tool_sources.extend(ev["sources"])
            # tool 진행 이벤트는 그대로 통과 (UI 진행표시용)
            yield ev
        elif ev.get("type") == "stats":
            stats = {k: v for k, v in ev.items() if k != "type"}
        elif ev.get("type") == "rag_fallback":
            # 메모/뉴스RAG/첨부파일 자동조회 결과 — UI 진행 표시용으로 그대로 통과
            yield ev

    answer = "".join(parts).strip()

    # extra_context + (tool 판정 후 채운) 메모/RAG 문서 + tool sources 병합
    # (url 기준 중복 제거)
    all_sources = list(docs) + post_docs
    seen_urls = {s.get("url") for s in all_sources if s.get("url")}
    for s in tool_sources:
        if s.get("url") and s["url"] not in seen_urls:
            seen_urls.add(s["url"])
            all_sources.append(s)

    yield {"type": "final", "result": {
        "answer": answer,
        "response_type": "simple",
        "sources": all_sources,
        "model": await get_model_name(),
        "stats": stats,
    }}
