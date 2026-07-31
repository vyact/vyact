"""
routers/chat.py – 채팅 / 검색 / 인덱스
"""
import uuid
import re
import asyncio
from datetime import datetime, timezone

import json
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from agent import (
    rag_query, save_conversation, create_conversation_stub,
    get_es, ensure_index, get_prompt_by_id,
    query_llm, get_model_name,
    get_conversation, rag_query_stream,
)
from services.llm import chat_stream_with_tools
from config import IMAGE_MODEL_IDS
from prompts import VOICE_MODE_SUFFIX, FORMAT_INSTRUCTION, EXTENSION_FORMAT_INSTRUCTION, get_extension_format_instruction
from routers.deps import load_config_async
from routers.chat_helpers import (
    extract_paste_context, load_system_prompt,
    resolve_selected_articles, search_file_id_chunks,
    build_injected_context, build_user_message, build_assistant_message,
    filter_article_sources,
    limit_direct_document_contexts,
)

# create_task로 띄운 백그라운드 저장 작업(히스토리/인덱싱/요약)이 참조를 잃고 GC돼서
# 중간에 취소되는 걸 막기 위한 강한 참조 보관용. (asyncio 공식 권장 패턴)
_background_tasks: set[asyncio.Task] = set()


def _run_in_background(coro) -> None:
    task = asyncio.create_task(coro)
    _background_tasks.add(task)
    task.add_done_callback(_background_tasks.discard)
from services.db import INDEX_NAME, DOC_CHUNKS_INDEX, HIST_INDEX, PROJECTS_INDEX, LANGUAGES, get_language_index
from services.indexer import get_embedding, get_es as get_es_client
from services.plugin_manager import has_plugin_url_resolvers, resolve_plugin_url
from routers.images import ImageGenerateRequest, generate_image
from logger import get_logger

logger = get_logger(__name__)

router = APIRouter()


def _new_conversation_title(conv_summary: str | None, fallback_question: str) -> str:
    """새 대화의 사이드바 제목을 이미 생성된 대화 요약에서 만든다.

    요약은 최종 응답에 함께 생성되어 이 시점에 별도 LLM 호출 없이 사용할 수 있다.
    태그가 누락되거나 빈 경우에는 기존처럼 첫 질문을 제목으로 사용한다.
    """
    fallback = re.sub(r"\s+", " ", fallback_question).strip()
    summary = re.sub(r"\s+", " ", conv_summary or "").strip()
    if not summary:
        return fallback[:30] + ("..." if len(fallback) > 30 else "")

    first_sentence = re.split(r"(?<=[.!?])\s+", summary, maxsplit=1)[0].strip()
    title = first_sentence.rstrip(".。!? ")
    return title[:36] + ("..." if len(title) > 36 else "")


async def _resolve_code_folder_path(folder_path: str, project_id: str) -> str:
    """명시적으로 첨부한 폴더를 우선하고, 없으면 선택 프로젝트의 폴더를 사용한다."""
    if folder_path.strip():
        return folder_path.strip()
    if not project_id:
        return ""

    folder_paths = await _get_project_folder_paths(project_id)
    return folder_paths[0] if folder_paths else ""


async def _get_project_folder_paths(project_id: str) -> list[str]:
    if not project_id:
        return []
    es = get_es()
    try:
        project = await es.get(index=PROJECTS_INDEX, id=project_id)
        folder_paths = project.get("_source", {}).get("folder_paths", [])
        return [str(path).strip() for path in folder_paths if str(path).strip()] if isinstance(folder_paths, list) else []
    except Exception as e:
        logger.warning("[query_stream] 프로젝트 폴더 조회 실패(project_id=%s): %s", project_id, e)
        return []
    finally:
        await es.close()


async def _get_project_prompt(project_id: str) -> str:
    if not project_id:
        return ""
    from services.db import get_es
    es = get_es()
    try:
        project = await es.get(index=PROJECTS_INDEX, id=project_id)
        return str(project.get("_source", {}).get("project_prompt", "")).strip()
    except Exception as e:
        logger.warning("[query_stream] 프로젝트 지침 조회 실패(project_id=%s): %s", project_id, e)
        return ""
    finally:
        await es.close()


async def _get_project_folder_context(project_id: str) -> str:
    """선택 프로젝트의 모든 소스 폴더를 LLM 컨텍스트로 제공한다."""
    if not project_id:
        return ""
    try:
        folder_paths = await _get_project_folder_paths(project_id)
        if not folder_paths:
            return ""
        return "[프로젝트 소스 폴더]\n" + "\n".join(
            f"- folder_{index}: {path}" for index, path in enumerate(folder_paths, 1)
        ) + "\n모든 code_* 도구 호출에 작업 대상 folder_id를 반드시 지정해야 한다."
    except Exception as e:
        logger.warning("[query_stream] 프로젝트 폴더 조회 실패(project_id=%s): %s", project_id, e)
        return ""

URL_RE = re.compile(r"https?://[^\s)\]'\"<>,\u0080-\uFFFF]+")
URL_CONTEXT_ERROR_KEY = "_url_context_error"


def _should_crawl_urls(text: str, urls: list[str]) -> list[str]:
    """크롤링할 URL만 걸러냄. 코드블록/문자열 문맥 안 URL은 제외."""
    # 코드블록(``` ... ```) 범위 추출
    code_block_ranges: list[tuple[int, int]] = []
    for m in re.finditer(r'```[\s\S]*?```', text):
        code_block_ranges.append((m.start(), m.end()))

    crawlable = []
    for url in urls:
        pos = text.find(url)
        if pos == -1:
            continue
        # 코드블록 안이면 스킵
        if any(s <= pos <= e for s, e in code_block_ranges):
            continue
        # URL 직전 30자에 코드 문맥 신호(=, :, (, [, ,, ", ')가 있으면 스킵
        prefix = text[max(0, pos - 30):pos]
        if re.search(r'[=:([,"\'][ \t]*$', prefix):
            continue
        crawlable.append(url)
    return crawlable


async def resolve_url_content(url: str) -> dict | None:
    """활성화된 URL 컨텍스트 플러그인에 URL 처리를 위임한다."""
    return await resolve_plugin_url(url)


def _get_url_context_errors(results: list[dict | None]) -> list[dict]:
    return [result[URL_CONTEXT_ERROR_KEY] for result in results if result and URL_CONTEXT_ERROR_KEY in result]


def _format_url_context_error(errors: list[dict]) -> str:
    details = "\n".join(
        f"- {error.get('url', '')}\n  사유: {error.get('message', '')}"
        for error in errors
    )
    return f"❌ 다음 URL을 읽을 수 없습니다:\n{details}"


class QueryRequest(BaseModel):
    question: str
    conv_id: str = ""
    messages: list = []
    system_prompt: str = ""
    attachments: list = []
    articles: list = []  # 첨부 기사 (있으면 ES RAG 스킵)
    article_selection_explicit: bool = False  # True면 빈 목록도 사용자의 명시적 첨부 해제로 취급
    voice_mode: bool = False  # 음성 대화 모드 (format_instruction 제거)
    user_timestamp: str = ""  # 전송 시점 timestamp (프론트에서 전달)
    no_history: bool = False  # True면 히스토리 저장 안 함
    reasoning: bool = False  # True면 추론(gemma thinking) 켬. 프론트/확장 로컬 스위치로 제어. 기본 off
    folder_path: str = ""  # 코드 분석용 폴더 경로 (프론트에서 선택)
    project_id: str = ""
    knowledge_collection_id: str = ""  # 선택한 지식 컬렉션의 자료만 RAG 검색
    minimal_prompt: bool = False  # True면 앱 전용 기본 프롬프트(FORMAT_INSTRUCTION, conv_summary 태그 지시) 제외.
    selected_mcp_ids: list[str] = []  # @로 선택한 MCP들은 enabled 여부와 무관하게 이번 요청에만 사용.
    # 크롬 확장처럼 프로젝트 블록/followups/SummaryModal UI가 없는 경량 클라이언트용.
    # 날짜/사용자 프로필/참고 문서/MCP tool directive는 그대로 유지된다.


def _file_attachments_to_context(attachments: list) -> list[dict]:
    """type='file'|'zip' attachment를 context_docs 형태로 변환"""
    docs = []
    for att in attachments:
        if att.get("type") == "zip":
            for f in att.get("files", []):
                if f.get("content", "").strip():
                    docs.append({
                        "title": f["filename"],
                        "content": f["content"],
                        "source": f"zip:{att.get('original_name', '')}",
                        "url": "",
                        "score": 1.0,
                        "indexed_at": "",
                        "direct_document": True,
                    })
        elif att.get("type") == "file":
            if att.get("content", "").strip():
                docs.append({
                    "title": att.get("original_name", "첨부파일"),
                    "content": att["content"],
                    "source": "첨부파일",
                    "url": "",
                    "score": 1.0,
                    "indexed_at": "",
                    "direct_document": True,
                })
    return docs


def _group_attachments_for_indexing(attachments: list) -> list[tuple[str, list[dict]]]:
    """zip/file attachment 목록을 (source_name, file_docs) 튜플 리스트로 정리.
    index_chat_files/index_chat_files_progress에 그대로 넘기기 위한 공용 전처리."""
    groups: list[tuple[str, list[dict]]] = []
    for att in attachments:
        if att.get("type") == "zip":
            file_docs = att.get("files", [])
            source_name = att.get("original_name", "")
        elif att.get("type") == "file":
            file_docs = [{
                "filename": att.get("original_name", "첨부파일"),
                "content": att.get("content", ""),
                "size": att.get("size"),
            }]
            source_name = att.get("original_name", "")
        else:
            continue
        if file_docs:
            groups.append((source_name, file_docs))
    return groups


def _trigger_chat_file_indexing(conv_id: str, attachments: list) -> list[dict]:
    """
    zip/file 첨부를 청크+임베딩으로 백그라운드 인덱싱한다 (LLM 호출 없음, 응답 지연 없음).
    같은 conv_id로 다음 턴에 재첨부 없이도 관련 파일을 검색할 수 있게 하기 위함.

    ⚠ 스트리밍 경로(query_stream)에서는 이 함수 대신 아래 _index_attachments_sequential()을
    쓴다 — 백그라운드로 돌리면 로컬 환경에서 같은 GPU를 임베딩과 LLM 추론이 나눠 쓰면서
    실제 응답 생성이 느려지는 문제가 있어(둘 다 Ollama가 처리), 인덱싱을 먼저 끝내고
    나서 LLM을 호출하는 쪽이 더 안전하다고 판단했다. 이 함수는 진행 표시가 불가능한
    비스트리밍 /query 경로에서만 계속 쓴다.

    반환값: [{"batch_id", "source_name", "file_count"}, ...] — 실제 인덱싱(임베딩)은 백그라운드에서
    진행되지만, batch_id/파일 개수는 즉시 알 수 있으므로 project_summary를 이 배치에 매칭시키는 데 쓴다.
    """
    if not attachments:
        return []
    from services.chat_file_index import index_chat_files

    batches = []
    for source_name, file_docs in _group_attachments_for_indexing(attachments):
        batch_id = str(uuid.uuid4())
        asyncio.create_task(index_chat_files(conv_id, source_name, file_docs, batch_id=batch_id))
        batches.append({"batch_id": batch_id, "source_name": source_name, "file_count": len(file_docs)})
    return batches


async def _index_attachments_sequential(conv_id: str, attachments: list):
    """
    스트리밍 경로 전용: 첨부파일 인덱싱을 LLM 호출 '전에' 끝까지 마치고, 진행 상황을
    {"source_name", "done", "total"} 형태로 yield한다. 호출부(query_stream)가 이걸 그대로
    SSE "index_progress" 이벤트로 클라이언트에 흘려서 "인덱싱 중 (12/245)" 같은 진행 표시를
    할 수 있게 한다. 마지막에 배치 메타정보 리스트를 담은 {"done_all": [...]}를 yield한다.
    """
    from services.chat_file_index import index_chat_files_progress

    groups = _group_attachments_for_indexing(attachments)
    if not groups:
        yield {"done_all": []}
        return

    batches: list[dict] = []
    for source_name, file_docs in groups:
        batch_id = str(uuid.uuid4())
        async for ev in index_chat_files_progress(conv_id, source_name, file_docs, batch_id=batch_id):
            if ev["type"] == "progress":
                yield {"source_name": source_name, "done": ev["done"], "total": ev["total"]}
            elif ev["type"] == "result":
                batches.append({
                    "batch_id": ev["batch_id"], "source_name": source_name, "file_count": len(file_docs),
                })
    yield {"done_all": batches}


@router.post("/query")
async def query(req: QueryRequest):
    if not req.question.strip() and not req.attachments:
        raise HTTPException(400, "질문 또는 이미지를 입력하세요.")

    # 1) 붙여넣기 마커 추출
    original_question = req.question
    clean_question, paste_context = extract_paste_context(req.question)
    req = req.model_copy(update={"question": clean_question})

    # 2) 설정/시스템 프롬프트 로드
    cfg, current_model, system_prompt = await load_system_prompt(req.system_prompt)
    project_prompt = await _get_project_prompt(req.project_id)
    if project_prompt:
        system_prompt = f"{system_prompt}\n\n[프로젝트 지침]\n{project_prompt}" if system_prompt else project_prompt
    project_folder_context = await _get_project_folder_context(req.project_id)
    if project_folder_context:
        system_prompt = f"{system_prompt}\n\n{project_folder_context}" if system_prompt else project_folder_context

    # 이미지 생성 모델이면 위임
    if cfg.get("model_type") in ("image_gen", "image_edit") or current_model in IMAGE_MODEL_IDS:
        return await generate_image(ImageGenerateRequest(
            prompt=req.question, conv_id=req.conv_id,
            messages=req.messages, attachments=req.attachments,
        ))

    if req.voice_mode and system_prompt:
        system_prompt += VOICE_MODE_SUFFIX

    # 3) 첨부파일 분류 (분석용 context / 이미지)
    file_context_docs, image_attachments = (
        _file_attachments_to_context(req.attachments) + paste_context,
        [a for a in req.attachments if a.get("type") == "image"],
    )

    # 4) conv_id 확정 + 첨부파일 임베딩 인덱싱 (백그라운드)
    conv_id = req.conv_id or str(uuid.uuid4())
    from services.conv_summary import get_prior_conv_summary
    conversation_summary = await get_prior_conv_summary(conv_id)
    _chat_file_batches = _trigger_chat_file_indexing(conv_id, req.attachments) if not req.no_history else []

    # 6) 이전 assistant의 article_sources에서 file_id 승계
    articles = resolve_selected_articles(
        req.articles,
        req.messages,
        selection_explicit=req.article_selection_explicit,
    )

    # 7) LLM 호출 분기
    if articles:
        # 기사/문서 첨부
        direct_docs, file_chunks = await search_file_id_chunks(req.question, articles)
        context_docs = direct_docs + file_chunks
        raw_answer = await query_llm(req.question, limit_direct_document_contexts(file_context_docs + context_docs), system_prompt, image_attachments,
                                     req.messages,
                                     format_instruction_override="" if req.voice_mode else None,
                                     conversation_summary=conversation_summary,
                                     reasoning=req.reasoning, call_reason="chat:article_attachment")
        result = {"answer": raw_answer, "sources": context_docs, "model": await get_model_name()}
    elif req.voice_mode:
        raw_answer = await query_llm(req.question, file_context_docs, system_prompt, image_attachments, req.messages,
                                     format_instruction_override="", use_tools=False,
                                     conversation_summary=conversation_summary,
                                     reasoning=req.reasoning, call_reason="chat:voice_mode")
        result = {"answer": raw_answer, "sources": [], "model": await get_model_name()}
    else:
        # URL 크롤링
        all_urls = [u.rstrip('.') for u in URL_RE.findall(req.question)]
        urls = _should_crawl_urls(req.question, all_urls) if has_plugin_url_resolvers() else []
        url_docs: list[dict] = []
        url_error_answer: str | None = None
        if urls:
            targets = urls[:3]
            tasks = [resolve_url_content(u) for u in targets]
            results_url = await asyncio.gather(*tasks)
            url_errors = _get_url_context_errors(results_url)
            if url_errors:
                url_error_answer = _format_url_context_error(url_errors)
            else:
                url_docs = [result for result in results_url if result]

        if url_error_answer:
            result = {"answer": url_error_answer, "sources": [], "model": await get_model_name()}
        elif url_docs:
            rag_result = await rag_query(req.question, system_prompt, image_attachments, req.messages,
                                         reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                         call_reason="chat:url_context", knowledge_collection_id=req.knowledge_collection_id)
            combined_docs = file_context_docs + url_docs + rag_result.get("sources", [])
            raw_answer = await query_llm(
                req.question, combined_docs, system_prompt,
                image_attachments, req.messages,
                format_instruction_override=None,
                conversation_summary=conversation_summary,
                reasoning=req.reasoning, call_reason="chat:url_context",
            )
            result = {"answer": raw_answer, "sources": combined_docs, "model": await get_model_name()}
        else:
            _has_file_att = any(a.get("type") in ("file", "zip") for a in req.attachments)
            from services.conv_summary import build_summary_instruction
            _summary_base_prompt = system_prompt if system_prompt else FORMAT_INSTRUCTION
            _summary_system_prompt = _summary_base_prompt + build_summary_instruction("", _has_file_att)
            result = await rag_query(req.question, _summary_system_prompt, image_attachments, req.messages,
                                     extra_context=file_context_docs, skip_rag=_has_file_att,
                                     reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                     call_reason="chat:general", knowledge_collection_id=req.knowledge_collection_id)

    # 8) 요약 태그 추출 + 히스토리 저장
    from services.conv_summary import extract_summary_tags, save_conv_summary, append_attachment_summary
    _clean_answer, _conv_summary, _project_summary = extract_summary_tags(result.get("answer", ""))
    result["answer"] = _clean_answer

    user_ts = req.user_timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result_sources = result.get("sources", [])
    injected_context = build_injected_context(result_sources)
    user_message = build_user_message(original_question, user_ts, req.attachments, articles)
    article_sources = filter_article_sources(result_sources)
    assistant_msg = build_assistant_message(result["answer"], result.get("model", ""), article_sources, injected_context)

    messages = req.messages + [user_message, assistant_msg]
    result["conv_id"] = conv_id

    if not req.no_history:
        try:
            await save_conversation(conv_id, messages)
            if _conv_summary:
                await save_conv_summary(conv_id, _conv_summary)
            for _batch in _chat_file_batches:
                await append_attachment_summary(
                    conv_id, _project_summary, _batch["source_name"], _batch["file_count"], _batch["batch_id"],
                )
        except Exception as e:
            logger.warning("[query] 히스토리 저장 실패: %s", e)

    return result


@router.get("/article-by-url")
async def get_article_by_url(url: str):
    """URL로 단일 기사 조회 (PPT 재편집용)"""
    es = get_es()
    try:
        res = await es.search(index=INDEX_NAME, body={
            "query": {"term": {"url.keyword": url}},
            "size": 1,
        })
        hits = res["hits"]["hits"]
        if not hits:
            raise HTTPException(404, "기사를 찾을 수 없습니다")
        src = hits[0]["_source"]
        return {
            "title": src.get("title", ""),
            "url": src.get("url", ""),
            "content": src.get("content", ""),
            "source": src.get("source", ""),
            "indexed_at": src.get("indexed_at", ""),
        }
    finally:
        await es.close()


@router.delete("/index")
async def delete_index():
    es = get_es()
    try:
        await es.indices.delete(index=[get_language_index("rag_documents", language) for language in LANGUAGES], ignore_unavailable=True)
        await ensure_index()
        return {"message": "인덱스 초기화 완료"}
    finally:
        await es.close()


def _sse(event: str, data: dict) -> str:
    """SSE 프레임 직렬화 — event 이름 + JSON data."""
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


@router.post("/query/stream")
async def query_stream(req: QueryRequest):
    """채팅 토큰 SSE 스트리밍 엔드포인트.

    질문 유형에 따라 아래 네 경로 중 하나로 분기한다:

      (A) 기사/문서 첨부  — req.articles 가 있음
          선택한 기사·인덱싱 문서(+ file_id 청크)를 context로 스트리밍.
          답이 선택된 문서 안에서 나오므로 tool 판정을 하지 않는다(use_tools=False).

      (B) URL 크롤링      — 질문에 URL이 있고 크롤링 성공
          크롤링 본문 + RAG 소스를 context로 스트리밍. (A)와 같이 tool 미사용.

      (C) 이미지 생성/voice_mode — 스트리밍 미지원
          논스트리밍 /query 로 위임하고, 전체 답변을 token 1회 + done 으로 방출.

      (D) 일반 채팅       — 위 어디에도 해당 없음
          rag_query_stream 경유 (RAG/메모 context + MCP tool 루프).
          여기서만 tool(파일/GitHub 등)을 사용한다.

    SSE 이벤트: meta(모델·출처) / token(본문 조각) / tool(도구 진행) / done(대화ID·최종답).

    스트림이 끝나면 대화를 히스토리에 저장한다(req.no_history=True 면 생략).
    user 발화 시각은 "요청 도착 시점"으로 고정한다 — 스트림 종료 후 now로 찍으면
    user/assistant 타임스탬프가 같아져 버리기 때문이다.
    """

    async def stream():
        mcp_scope_token = None
        _saved = False
        try:
            if req.selected_mcp_ids:
                from services.mcp_client import mcp_manager
                mcp_scope_token = await mcp_manager.enable_request_scope(req.selected_mcp_ids)
            # user 발화 시각을 요청 도착 시점으로 고정 (프론트가 전송 시각을 주면 우선 사용)
            user_ts = req.user_timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            # 1) 붙여넣기 마커 추출
            original_question = req.question
            clean_question, paste_context = extract_paste_context(req.question)

            # 2) 설정/시스템 프롬프트 로드
            cfg, current_model, system_prompt = await load_system_prompt(req.system_prompt)
            project_prompt = await _get_project_prompt(req.project_id)
            if project_prompt:
                system_prompt = f"{system_prompt}\n\n[프로젝트 지침]\n{project_prompt}" if system_prompt else project_prompt
            project_folder_context = await _get_project_folder_context(req.project_id)
            if project_folder_context:
                system_prompt = f"{system_prompt}\n\n{project_folder_context}" if system_prompt else project_folder_context

            # 사용자 UI 언어 (확장 클라이언트의 포맷 지시 언어 결정용)
            _ui_language = ""
            if req.minimal_prompt:
                try:
                    from routers.deps import load_ui_language_async
                    _ui_language = await load_ui_language_async() or ""
                except Exception:
                    pass

            # 3) 첨부파일 분류
            file_context_docs = _file_attachments_to_context(req.attachments) + paste_context
            image_attachments = [a for a in req.attachments if a.get("type") == "image"]

            # conv_id를 여기서 미리 확정한다.
            conv_id = req.conv_id or str(uuid.uuid4())
            from services.conv_summary import get_prior_conv_summary
            conversation_summary = await get_prior_conv_summary(conv_id)

            # 첨부파일 임베딩 인덱싱은 LLM 호출 '전에' 끝까지 마친다. (예전엔 LLM 호출과
            # 동시에 백그라운드로 돌렸는데, 로컬 환경에서는 임베딩 모델과 채팅 모델이 같은
            # GPU 자원을 나눠 쓰면서 실제 답변 생성 속도가 눈에 띄게 느려지는 문제가 있었다.
            # 인덱싱을 먼저 끝내고 나서 LLM을 부르는 게 더 안전하다 — 대신 사용자가 그냥
            # 멈춘 걸로 오해하지 않도록 "index_progress" SSE로 진행 상황을 계속 흘려준다.)
            _early_chat_file_batches: list[dict] = []
            if not req.no_history and req.attachments:
                async for _idx_ev in _index_attachments_sequential(conv_id, req.attachments):
                    if "done_all" in _idx_ev:
                        _early_chat_file_batches = _idx_ev["done_all"]
                    else:
                        yield _sse("index_progress", _idx_ev)

            model = await get_model_name()

            # 이전 assistant의 article_sources에서 file_id 승계
            articles = resolve_selected_articles(
                req.articles,
                req.messages,
                selection_explicit=req.article_selection_explicit,
            )

            # 질문에 포함된 URL 중 크롤링 대상 추출
            all_urls = [u.rstrip('.') for u in URL_RE.findall(clean_question)]
            urls = _should_crawl_urls(clean_question, all_urls) if has_plugin_url_resolvers() else []

            context_docs: list[dict] = []
            can_stream = False  # True면 아래 "실제 토큰 스트리밍"으로, False면 (C)/(D) 처리

            config = await load_config_async()
            is_image_model = config.get("model_type") in ("image_gen", "image_edit") or model in IMAGE_MODEL_IDS

            if not is_image_model and not req.voice_mode and articles:
                # ══ 경로 (A): 기사/문서 첨부 ══
                direct_docs, file_chunks = await search_file_id_chunks(clean_question, articles)
                context_docs = direct_docs + file_chunks
                docs_for_llm = limit_direct_document_contexts(file_context_docs + context_docs)
                can_stream = True

            elif not is_image_model and not req.voice_mode and urls:
                # ══ 경로 (B): URL 크롤링 ══
                targets = urls[:3]
                tasks = [resolve_url_content(u) for u in targets]
                results_url = await asyncio.gather(*tasks)
                url_errors = _get_url_context_errors(results_url)

                if url_errors:
                    error_message = _format_url_context_error(url_errors)
                    yield _sse("meta", {"model": model, "sources": []})
                    yield _sse("token", {"text": error_message})
                    yield _sse("done", {"conv_id": req.conv_id or "", "answer": error_message})
                    return

                url_docs = [result for result in results_url if result]
                if url_docs:
                    # URL 컨텍스트를 얻은 경우에만 본문을 추가한다. 실패한 URL은 원문 질문에
                    # 그대로 남으므로, 컨텍스트 없이 일반 채팅 경로로 LLM에 전달된다.
                    rag_result = await rag_query(clean_question, system_prompt, image_attachments, req.messages,
                                                 reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                                 call_reason="chat:url_context_stream")
                    context_docs = file_context_docs + url_docs + rag_result.get("sources", [])
                    docs_for_llm = context_docs
                    can_stream = True

            if not can_stream:
                # ══ 경로 (C): 이미지 생성 / voice_mode — 스트리밍 미지원 ══
                # 논스트리밍 /query 로 위임하고 전체 답변을 token 1회 + done 으로 방출
                if is_image_model or req.voice_mode:
                    result = await query(req)
                    yield _sse("meta", {"model": result.get("model", model), "sources": result.get("sources", [])})
                    yield _sse("token", {"text": result.get("answer", "")})
                    yield _sse("done", {"conv_id": result.get("conv_id", req.conv_id or ""),
                                        "answer": result.get("answer", ""),
                                        "stats": result.get("stats")})
                    return

                # ══ 경로 (D): 일반 채팅 (RAG/메모 context + MCP tool 루프) ══
                # 여기서만 tool(파일/GitHub 등)을 사용한다.

                final_result: dict = {}
                emitted = ""
                # 파일(zip/일반) 첨부가 있으면 답이 첨부 내용 안에서 나오므로
                # RAG/메모 검색을 스킵한다(무관한 뉴스 오염 방지). tool 루프는 유지.
                has_file_attachment = any(
                    a.get("type") in ("file", "zip") for a in req.attachments
                )

                # 대화 요약 태그 생성 지시 — 이 스트리밍 호출에만 덧붙인다.
                # minimal_prompt(크롬 확장)면 요약 태그 지시를 통째로 생략하고
                # FORMAT_INSTRUCTION 대신 EXTENSION_FORMAT_INSTRUCTION을 쓴다
                # (SummaryModal/followups UI가 없는 클라이언트라 입력·출력 토큰만 낭비됨).
                if req.minimal_prompt:
                    _summary_system_prompt = system_prompt
                    _fmt_override = get_extension_format_instruction(_ui_language) if _ui_language else EXTENSION_FORMAT_INSTRUCTION
                else:
                    from services.conv_summary import build_summary_instruction
                    _summary_base_prompt = system_prompt if system_prompt else FORMAT_INSTRUCTION
                    _summary_system_prompt = _summary_base_prompt + build_summary_instruction("", has_file_attachment)
                    _fmt_override = None

                # 모든 등록 폴더를 ID로 노출한다. 코드 도구는 매 호출마다 folder_id를 요구한다.
                code_folder_path = await _resolve_code_folder_path(req.folder_path, req.project_id)
                if code_folder_path:
                    from services.code_tools import current_code_folder, current_code_folders, current_code_question
                    folder_paths = [req.folder_path.strip()] if req.folder_path.strip() else await _get_project_folder_paths(req.project_id)
                    current_code_folders.set({f"folder_{index}": path for index, path in enumerate(folder_paths, 1)})
                    current_code_folder.set(code_folder_path)
                    current_code_question.set(clean_question)

                _tool_messages: list[dict] = []  # tool call/result 메시지 수집
                async for ev in rag_query_stream(
                        clean_question, _summary_system_prompt, image_attachments, req.messages,
                        extra_context=limit_direct_document_contexts(file_context_docs),
                        skip_rag=has_file_attachment,
                        reasoning=req.reasoning,
                        conv_id=conv_id,
                        conversation_summary=conversation_summary,
                        format_instruction_override=_fmt_override,
                        call_reason="chat:general_stream",
                        knowledge_collection_id=req.knowledge_collection_id,
                ):
                    if ev["type"] == "token":
                        emitted += ev["text"]
                        yield _sse("token", {"text": ev["text"]})
                    elif ev["type"] == "reset":
                        # relay된 서두를 프론트에서 지우도록 지시 (뒤늦은 tool 호출 케이스)
                        emitted = ""
                        _tool_messages.clear()
                        yield _sse("reset", {})
                    elif ev["type"] == "tool":
                        # tool call/result 메시지 수집 (히스토리 저장용)
                        if ev.get("phase") == "start" and ev.get("name"):
                            _tool_messages.append({
                                "role": "assistant",
                                "tool_calls": [{"name": ev["name"], "args": ev.get("args", {})}],
                            })
                        elif ev.get("phase") == "end" and ev.get("name") and ev.get("result") is not None:
                            # tool 결과가 너무 크면 히스토리 저장용으로 잘라냄
                            _result = ev["result"]
                            if len(_result) > 8000:
                                _result = _result[:8000] + "\n...(truncated)"
                            _tool_messages.append({
                                "role": "tool",
                                "name": ev["name"],
                                "content": _result,
                            })
                        yield _sse("tool", ev)
                    elif ev["type"] == "rag_fallback":
                        # 메모/뉴스RAG/첨부파일 자동조회 진행 표시 (tool과 동일한 start/end 형식으로 변환)
                        yield _sse("tool", {"phase": "start", "name": "search_related_context"})
                        yield _sse("tool", {"phase": "end", "name": "search_related_context"})
                    elif ev["type"] == "final":
                        final_result = ev["result"]

                answer = final_result.get("answer", emitted).strip()
                gen_sources = final_result.get("sources", []) or []
                gen_model = final_result.get("model", model)
                gen_stats = final_result.get("stats")
                yield _sse("meta", {"model": gen_model, "sources": gen_sources})

                # 답변에서 <conv_summary>/<project_summary> 숨김 태그 추출 후 제거 (사용자에겐 안 보임).
                # 정규식 처리라 빠르므로 done 이벤트 전에 해도 지연 없음 — done에 실릴 answer는 이 clean 버전이어야 함.
                from services.conv_summary import extract_summary_tags, save_conv_summary, append_attachment_summary
                answer, _conv_summary, _project_summary = extract_summary_tags(answer)

                injected_context = build_injected_context(gen_sources)
                user_message = build_user_message(original_question, user_ts, req.attachments)
                # "참고" 표시용 — url이 있는 소스만
                article_sources = [s for s in gen_sources if s.get("url") and s.get("source") != "붙여넣기"]
                assistant_msg = build_assistant_message(answer, gen_model, article_sources, injected_context, gen_stats)

                # 여기까진 전부 순수 계산(빠름). ES 저장(save_conversation의 refresh=True 등)과
                # 첨부파일 임베딩 인덱싱은 실제 I/O라 응답을 막지는 않는다. 단, 브라우저가 done을
                # 받은 직후 새로고침해도 저장 코루틴이 취소되지 않도록 background task는 done 전에 등록한다.
                # 다만 "새 대화방"인 경우엔, 사이드바 목록(GET /api/history)이 done 직후 바로 조회해도
                # 방이 보이도록 최소 필드짜리 문서만 먼저 동기로 만들어둔다(가벼워서 지연 거의 없음).
                # 주의: 프론트가 새 대화 시작 시 client-side로 conv_id(UUID)를 미리 생성해서 보내므로
                # req.conv_id 존재 여부로는 "새 방"인지 판단할 수 없다 — ES에 실제 문서가 있는지로 판단.
                if not req.no_history:
                    es_check = get_es()
                    try:
                        conv_exists = await es_check.exists(index=HIST_INDEX, id=conv_id)
                    finally:
                        await es_check.close()
                    if not conv_exists:
                        try:
                            await create_conversation_stub(
                                conv_id,
                                _new_conversation_title(_conv_summary, original_question),
                                req.project_id or None,
                            )
                        except Exception as e:
                            logger.warning("[query_stream] 대화방 stub 생성 실패: %s", e)

                if not req.no_history:
                    async def _save_history_bg():
                        try:
                            await save_conversation(conv_id, req.messages + [user_message] + _tool_messages + [assistant_msg], project_id=req.project_id or None)
                            # save_conversation 완료 후에 요약 필드 병합 저장
                            if _conv_summary:
                                await save_conv_summary(conv_id, _conv_summary)
                            # project_summary(LLM 요약)가 없어도 배치 메타정보는 항상 남긴다 (요약은 폴백 문구)
                            # (인덱싱 자체는 이미 함수 앞부분에서 LLM 호출과 병렬로 시작됨 — 여기서 다시 트리거하지 않는다)
                            for _batch in _early_chat_file_batches:
                                await append_attachment_summary(
                                    conv_id, _project_summary, _batch["source_name"], _batch["file_count"], _batch["batch_id"],
                                )
                        except Exception as e:
                            logger.warning("[query_stream] 히스토리 저장 실패(일반채팅, 백그라운드): %s", e)

                    _run_in_background(_save_history_bg())

                yield _sse("done", {"conv_id": conv_id, "answer": answer, "stats": gen_stats})
                _saved = True
                return

            # ── 실제 토큰 스트리밍 (경로 A·B: 문서/URL context 기반, tool 미사용) ──
            yield _sse("meta", {"model": model, "sources": context_docs})

            parts: list[str] = []
            stats: dict | None = None
            # 선택된 문서/기사/URL 기반 질의 — 답은 이 context 안에서 나오므로 tool 판정 불필요
            async for ev in chat_stream_with_tools(
                    clean_question, docs_for_llm, system_prompt, image_attachments, req.messages,
                    format_instruction_override="" if req.voice_mode
                    else (get_extension_format_instruction(_ui_language) if req.minimal_prompt else None),
                    conversation_summary=conversation_summary,
                    use_tools=False,
                    reasoning=req.reasoning,
                    call_reason="chat:selected_docs",
            ):
                if ev.get("type") == "token":
                    parts.append(ev.get("text", ""))
                    yield _sse("token", {"text": ev.get("text", "")})
                elif ev.get("type") == "tool":
                    yield _sse("tool", ev)
                elif ev.get("type") == "stats":
                    stats = {k: v for k, v in ev.items() if k != "type"}

            answer = "".join(parts).strip()

            # ── 히스토리 저장 (공통 헬퍼 사용) ──
            injected_context = build_injected_context(context_docs)
            user_message = build_user_message(original_question, user_ts, req.attachments, articles)
            article_sources = filter_article_sources(context_docs)
            assistant_msg = build_assistant_message(answer, model, article_sources, injected_context, stats)

            if not req.no_history:
                try:
                    await save_conversation(conv_id, req.messages + [user_message, assistant_msg], project_id=req.project_id or None)
                except Exception as e:
                    logger.warning("[query_stream] 히스토리 저장 실패: %s", e)
            _saved = True

            yield _sse("done", {"conv_id": conv_id, "answer": answer, "stats": stats})
        except (asyncio.CancelledError, GeneratorExit):
            logger.info("[query_stream] 클라이언트 연결 종료 — 스트림 중단")
        finally:
            if mcp_scope_token is not None:
                from services.mcp_client import mcp_manager
                from services.mcp_config import build_servers_config
                mcp_manager.reset_request_scope(mcp_scope_token)
                await mcp_manager.connect_all(await build_servers_config())
            if not _saved and not req.no_history:
                try:
                    partial = "".join(parts).strip() if 'parts' in dir() else ""
                    now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
                    msgs = req.messages + [
                        {"role": "user", "content": original_question, "timestamp": user_ts},
                    ]
                    if partial:
                        msgs.append({"role": "assistant", "content": partial + "\n\n*(중단됨)*",
                                     "timestamp": now, "model": model if 'model' in dir() else ""})
                    _run_in_background(save_conversation(conv_id, msgs))
                except Exception as e:
                    logger.warning("[query_stream] 중단 시 저장 실패: %s", e)

    return StreamingResponse(stream(), media_type="text/event-stream")


# ── 번역 전용 엔드포인트 (RAG/도구 호출 없이 LLM 1회만 호출) ──────────────────
class TranslateRequest(BaseModel):
    text: str
    target_lang: str  # "영어" | "한국어" 등
    instruction: str = ""  # 커스텀 지시문 (있으면 기본 프롬프트 대신 사용)
    save_history: bool = False
    conv_id: str = ""
    history_label: str = ""  # 히스토리에 표시할 user 메시지 (없으면 자동 생성)


# 익스텐션의 extractVocabFromAnswer()와 동일한 정제 로직.
# LLM 원본 응답은 "단어: 뜻 | 원문 문장 | 번역 문장" 형식으로 단어마다 문장이
# 통째로 딸려오는데, 익스텐션은 클라이언트단에서 이걸 "단어: 뜻"만 남기고
# 보여주지만 히스토리 저장은 백엔드에서 원본 그대로 저장해버려서 vyact 본앱
# 히스토리에서 보면 문장이 단어 수만큼 중복으로 줄줄이 보였다.
# → 히스토리에 저장할 때만 동일하게 정제해서 저장한다 (API 응답 자체는 원본
#   유지: 익스텐션이 단어-문장 매칭으로 단어장에 저장할 때 원문/번역 문장이
#   필요하기 때문).
_VOCAB_LINE_RE = re.compile(
    r"^([A-Za-z][A-Za-z\s'\-]{0,30}):\s*(?:\([a-z]+\)\s*)?([^|]+?)\s*(?:\|\s*([^|]*?))?\s*(?:\|\s*([^|]*))?$")
_MARKER_LINE_RE = re.compile(r"^\[주요\s*단어\]$")
_LABEL_PREFIX_RE = re.compile(r"^(\s*)번역\s*[:\-]?\s*")


def _clean_translate_for_history(raw_answer: str) -> str:
    answer = (raw_answer or "").strip()
    if not answer:
        return answer

    body_lines: list[str] = []
    words: dict[str, str] = {}  # word(원형 표기 유지) -> meaning, 소문자 키로 중복 병합
    word_order: list[str] = []

    for line in answer.split("\n"):
        trimmed = line.strip()
        if _MARKER_LINE_RE.match(trimmed):
            continue
        m = _VOCAB_LINE_RE.match(trimmed)
        if m:
            word = m.group(1).strip()
            meaning = (m.group(2) or "").strip()
            key = word.lower()
            if key not in words:
                words[key] = meaning
                word_order.append((key, word))
            elif not words[key] and meaning:
                words[key] = meaning
            continue
        body_lines.append(line)

    cleaned_body_lines = [_LABEL_PREFIX_RE.sub(r"\1", l) for l in body_lines]
    body_text = re.sub(r"\n{3,}", "\n\n", "\n".join(cleaned_body_lines)).strip()

    if not words:
        return answer

    vocab_lines = "\n".join(
        f"{display_word}: {words[key]}" if words[key] else display_word
        for key, display_word in word_order
    )
    return f"{body_text}\n\n[주요 단어]\n{vocab_lines}"


@router.post("/translate")
async def translate(req: TranslateRequest):
    t_start = datetime.now(timezone.utc)
    logger.info(
        "[translate] 진입 target_lang=%s save_history=%s conv_id=%s text_len=%d preview=%r",
        req.target_lang, req.save_history, req.conv_id or "(new)", len(req.text), req.text[:80],
                                           )
    try:
        prompt = req.instruction or (
            f"다음 텍스트를 {req.target_lang}로 번역해줘. "
            f"번역 결과만 출력하고 설명은 하지 마:\n\n{req.text}"
        )
        gen_stats: dict = {}  # query_llm이 ollama 토큰수/처리시간 통계를 채움
        answer = await query_llm(
            prompt, [], "", [], [],
            timeout=300.0,
            format_instruction_override="",
            inject_user_profile=False,
            use_tools=False,
            num_predict=1024,
            reasoning=False,  # 번역은 추론 스위치와 무관하게 항상 off
            call_reason="translate",
            stats_out=gen_stats,
        )
        translated = answer.strip()

        conv_id = req.conv_id
        if req.save_history:
            conv_id = conv_id or str(uuid.uuid4())
            now = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            user_label = req.history_label or f"📝 번역 ({req.target_lang})"
            new_messages = [
                {"role": "user", "content": user_label, "timestamp": now},
                {"role": "assistant", "content": _clean_translate_for_history(translated), "timestamp": now,
                 **({"stats": gen_stats} if gen_stats else {})},
            ]
            # conv_id가 기존에 존재하는 대화면 덮어쓰지 않고 뒤에 이어붙인다.
            # (save_conversation은 넘긴 messages로 통째로 덮어쓰기 때문에,
            # 여기서 새 메시지만 넘기면 이전 대화 내용이 사라짐)
            existing = await get_conversation(conv_id)
            prior_messages = existing.get("messages", []) if existing else []
            await save_conversation(conv_id, prior_messages + new_messages)

        elapsed = (datetime.now(timezone.utc) - t_start).total_seconds()
        logger.info(
            "[translate] 종료 elapsed=%.2fs result_len=%d conv_id=%s",
            elapsed, len(translated), conv_id,
        )
        return {"translated": translated, "conv_id": conv_id, "stats": gen_stats or None}
    except Exception:
        elapsed = (datetime.now(timezone.utc) - t_start).total_seconds()
        logger.exception("[translate] 실패 elapsed=%.2fs conv_id=%s", elapsed, req.conv_id or "(new)")
        raise
