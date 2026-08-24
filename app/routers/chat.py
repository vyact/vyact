"""
routers/chat.py – 채팅 / 검색 / 인덱스
"""
import uuid
import re
import asyncio
from datetime import datetime, timezone
from urllib.parse import parse_qsl, urlencode, urlparse

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
from services.llm import chat_stream_with_tools, get_model_display_name
from services.llm.tools import tool_result_failed
from config import IMAGE_MODEL_IDS
from prompts import VOICE_MODE_SUFFIX, FORMAT_INSTRUCTION
from routers.deps import load_config_async
from routers.chat_helpers import (
    load_system_prompt, unwrap_pasted_text,
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
from services.tool_approval import ApprovalContext, current_approval_context, resolve_tool_approval
from routers.images import ImageGenerateRequest, generate_image
from logger import get_logger
from services.external_data.biz_support import SOURCE_ID as BIZ_SUPPORT_SOURCE_ID, search_candidates as search_biz_support_candidates
from services.external_data.gov24 import SOURCE_ID as GOV24_SOURCE_ID, search_candidates as search_gov24_candidates
from services.external_data.housing import SOURCE_ID as HOUSING_SOURCE_ID, search_candidates as search_housing_candidates
from services.external_data.lh_lease_complex import SOURCE_ID as LH_COMPLEX_SOURCE_ID, search_candidates as search_lh_complex_candidates
from services.external_data.lh_lease_notice import SOURCE_ID as LH_NOTICE_SOURCE_ID, search_candidates as search_lh_notice_candidates
from services.external_data.k_startup import SOURCE_ID as K_STARTUP_SOURCE_ID, search_candidates as search_k_startup_candidates
from services.external_data.settings import load_external_data_connections
from services.external_data.selected_documents import load_selected_external_documents, merge_external_context_documents
from services.external_data.messages import get_all_searches_failed_message
from services.user_profile import get_response_style_instruction

logger = get_logger(__name__)

router = APIRouter()


def _log_user_query(question: str) -> None:
    """API가 전달받은 사용자 질문 원문을 RAG용 가공 질의와 구분해 기록한다."""
    logger.info("[user_query] query=%r", question)

EXTERNAL_DATA_INSTRUCTION = """
[External public-data guidance]
The attached Government24 records are search candidates, not confirmed recommendations.
Apply hard eligibility constraints before writing the answer. A record with an explicit conflict in
residence, age, household type, income, housing, employment, or another mandatory condition must
not appear under eligible, likely, recommended, or currently available benefits. Do not ask follow-up
questions about a record that is already disqualified by a known hard constraint.

Use these result groups strictly:
1. Eligible now: every stated mandatory condition matches and the application is currently open.
2. Needs confirmation: no stated condition conflicts, but a mandatory fact or schedule is unknown.
3. Excluded: a stated condition conflicts or the deadline has passed.
If group 1 is empty, say clearly that no benefit can currently be confirmed. Keep excluded records
brief or omit them unless explaining why a seemingly relevant result was rejected. A missing required
condition such as childbirth, disability, emergency housing risk, or employment is never a positive
match; it belongs in needs confirmation only when no known fact conflicts.

Never invent missing eligibility conditions, and cite the underlying record when making a factual
claim. An active lifecycle status only means the record is still present in the source API; it does
not prove applications are currently open. Compare explicit application deadlines with today's date,
exclude expired records from currently available benefits, and mark unclear or recurring schedules
as needing confirmation. Answer in the user's language.
""".strip()


async def _with_response_style(system_prompt: str) -> str:
    """AI 프로필 포함 여부와 무관하게 채팅 응답 말투를 적용한다."""
    try:
        style_instruction = await get_response_style_instruction()
    except Exception as exc:
        logger.warning("[chat] response style load failed: %s", exc)
        return system_prompt
    if not style_instruction:
        return system_prompt
    style_context = f"[응답 스타일 및 말투]\n{style_instruction}"
    return f"{system_prompt}\n\n{style_context}" if system_prompt else style_context


async def _get_selected_external_context(question: str, resource_ids: list[str], document_selections: list[dict] | None = None) -> tuple[list[dict], str, bool, dict]:
    selected_ids = set(resource_ids)
    document_selections = document_selections or []
    if not selected_ids.intersection({GOV24_SOURCE_ID, BIZ_SUPPORT_SOURCE_ID, K_STARTUP_SOURCE_ID, HOUSING_SOURCE_ID, LH_COMPLEX_SOURCE_ID, LH_NOTICE_SOURCE_ID}) and not document_selections:
        return [], "", True, {"failed_sources": [], "all_failed": False, "no_results": False}
    searches = []
    if GOV24_SOURCE_ID in selected_ids:
        searches.append(("Government24", search_gov24_candidates(question)))
    if BIZ_SUPPORT_SOURCE_ID in selected_ids:
        searches.append(("BizInfo", search_biz_support_candidates(question)))
    if K_STARTUP_SOURCE_ID in selected_ids:
        searches.append(("K-Startup", search_k_startup_candidates(question)))
    if HOUSING_SOURCE_ID in selected_ids:
        searches.append(("housing", search_housing_candidates(question)))
    if LH_COMPLEX_SOURCE_ID in selected_ids:
        searches.append(("LH lease complex", search_lh_complex_candidates(question)))
    if LH_NOTICE_SOURCE_ID in selected_ids:
        searches.append(("LH notice", search_lh_notice_candidates(question)))
    settings_result, selected_documents_result, *results = await asyncio.gather(
        load_external_data_connections(),
        load_selected_external_documents(document_selections),
        *(search for _, search in searches),
        return_exceptions=True,
    )
    selected_candidates = selected_documents_result if isinstance(selected_documents_result, list) else []
    searched_candidates: list[dict] = []
    failed_sources: list[str] = []
    for (source_name, _), result in zip(searches, results):
        if isinstance(result, Exception):
            logger.warning("[external_data] %s candidate search failed: %s", source_name, result)
            failed_sources.append(source_name)
            continue
        searched_candidates.extend(result)
    # Candidate search results are intentionally compact for the LLM. Re-load the
    # matching records once so response inspection can render the same complete
    # detail view (attachments, source URL, record type, etc.) as the data browser.
    if searched_candidates:
        hydrated_candidates = await load_selected_external_documents([{
            "source_id": candidate.get("external_resource_id"),
            "document_id": candidate.get("id"),
        } for candidate in searched_candidates])
        hydrated_by_identity = {
            (item.get("external_resource_id"), item.get("id")): item
            for item in hydrated_candidates
        }
        searched_candidates = [
            hydrated_by_identity.get(
                (candidate.get("external_resource_id"), candidate.get("id")),
                candidate,
            )
            for candidate in searched_candidates
        ]
    candidates = merge_external_context_documents(selected_candidates, searched_candidates)
    # Keep the origin through response persistence so the client can present
    # explicitly selected external data separately from ordinary RAG context.
    candidates = [{**candidate, "context_origin": "external_data"} for candidate in candidates]
    custom_instruction = ""
    if isinstance(settings_result, dict):
        external_config = settings_result.get("kr.gov24") or {}
        custom_instruction = str(external_config.get("custom_instruction") or "").strip()
    instruction = EXTERNAL_DATA_INSTRUCTION
    if custom_instruction:
        instruction = (
            f"{instruction}\n\n[User-configured external-data preferences]\n"
            "Apply these preferences only when they do not conflict with the mandatory eligibility, "
            f"deadline, and source-grounding rules above.\n{custom_instruction}"
        )
    all_failed = bool(searches) and len(failed_sources) == len(searches) and not selected_candidates
    no_results = bool(searches or document_selections) and not candidates and not all_failed
    if failed_sources and not all_failed:
        instruction = (
            f"{instruction}\n\n[External-data retrieval status]\n"
            "The following selected sources could not be searched because of a technical error: "
            f"{', '.join(failed_sources)}. Answer using only the successfully retrieved records and "
            "briefly disclose which sources were unavailable in the user's language."
        )
    if no_results:
        instruction = (
            f"{instruction}\n\n[External-data retrieval status]\n"
            "The selected external-data search completed successfully but returned no matching records. "
            "State this clearly in the user's language and do not invent recommendations."
        )
    # A saved external-data instruction replaces the general AI profile. Without one,
    # preserve the normal profile as a useful fallback alongside the fixed safety rules.
    return candidates, instruction, not bool(custom_instruction), {
        "failed_sources": failed_sources,
        "all_failed": all_failed,
        "no_results": no_results,
    }


async def _external_search_failure_answer() -> str:
    from routers.deps import load_ui_language_async
    return get_all_searches_failed_message(await load_ui_language_async())


def _new_conversation_title(
        conv_title: str | None, conv_summary: str | None, fallback_question: str,
) -> str:
    """새 대화의 사이드바 제목을 이미 생성된 대화 요약에서 만든다.

    요약은 최종 응답에 함께 생성되어 이 시점에 별도 LLM 호출 없이 사용할 수 있다.
    태그가 누락되거나 빈 경우에는 기존처럼 첫 질문을 제목으로 사용한다.
    """
    fallback = re.sub(r"\s+", " ", unwrap_pasted_text(fallback_question)).strip()
    generated_title = re.sub(r"\s+", " ", conv_title or "").strip().strip(".。!? ")
    if generated_title:
        return generated_title[:36] + ("..." if len(generated_title) > 36 else "")
    summary = re.sub(r"\s+", " ", conv_summary or "").strip()
    if not summary:
        return fallback[:30] + ("..." if len(fallback) > 30 else "")

    first_sentence = re.split(r"(?<=[.!?])\s+", summary, maxsplit=1)[0].strip()
    title = first_sentence.rstrip(".。!? ")
    return title[:36] + ("..." if len(title) > 36 else "")


async def _get_request_folder_paths(folder_path: str, project_id: str) -> list[str]:
    """명시적으로 첨부한 폴더를 우선하고, 없으면 선택 프로젝트의 폴더를 사용한다."""
    if folder_path.strip():
        return [folder_path.strip()]
    if not project_id:
        return []

    return await _get_project_folder_paths(project_id)


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


async def _build_project_folder_context(folder_paths: list[str]) -> str:
    """요청의 소스 폴더와 제한된 파일 구조를 LLM 컨텍스트로 제공한다."""
    if not folder_paths:
        return ""
    try:
        from services.code_tools import build_code_folder_map, build_project_manifest
        folders = build_code_folder_map(folder_paths)
        manifest = await asyncio.to_thread(build_project_manifest, folder_paths)
        folder_context = "[프로젝트 소스 폴더]\n" + "\n".join(
            f"- {folder_id}: {path}" for folder_id, path in folders.items()
        )
        if manifest:
            folder_context += (
                "\n\n[프로젝트 파일 구조 — 자동 생성 manifest]\n"
                + manifest
                + "\n이 manifest는 경로 구조만 보여준다. 파일 내용이 필요한 경우 code_read_file 또는 "
                  "code_grep_search를 사용해 확인해야 한다."
            )
        return folder_context + "\n모든 code_* 도구 호출에 작업 대상 folder_id를 반드시 지정해야 한다."
    except Exception as e:
        logger.warning("[query_stream] 프로젝트 폴더 컨텍스트 생성 실패: %s", e)
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
    knowledge_collection_id: str = ""  # 이전 클라이언트 호환용 단일 컬렉션
    knowledge_collection_ids: list[str] = []  # 선택한 여러 지식 컬렉션의 자료를 함께 검색
    external_resource_ids: list[str] = []  # 사용자가 명시적으로 선택한 외부 데이터만 별도 검색
    external_document_selections: list[dict] = []  # 모달에서 명시적으로 첨부한 외부 데이터 원문
    minimal_prompt: bool = False  # True면 응답 언어 규칙 외에는 클라이언트 system_prompt만 사용하고 컨텍스트·도구·RAG 주입을 제외.
    selected_mcp_ids: list[str] = []  # @로 선택한 MCP들은 enabled 여부와 무관하게 이번 요청에만 사용.
    approval_mode: str = "risky_only"
    # 자막 학습처럼 요청 자체에 필요한 문맥이 모두 포함된 격리형 클라이언트용.


def _selected_knowledge_collection_ids(request: QueryRequest) -> list[str]:
    return list(dict.fromkeys([
        *request.knowledge_collection_ids,
        *([request.knowledge_collection_id] if request.knowledge_collection_id else []),
    ]))


@router.post("/tool-approvals/{approval_id}")
async def resolve_pending_tool_approval(approval_id: str, body: dict):
    if not resolve_tool_approval(approval_id, bool(body.get("approved")), str(body.get("response") or "")):
        raise HTTPException(status_code=404, detail="Approval request is no longer active.")
    return {"ok": True}


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
    실제 응답 생성이 느려지는 문제가 있어(둘 다 로컬 연산 자원을 사용), 인덱싱을 먼저 끝내고
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

    _log_user_query(req.question)

    # 1) 붙여넣기 UI 마커 제거 (본문은 사용자 질문으로 유지)
    original_question = req.question
    clean_question = unwrap_pasted_text(req.question)
    req = req.model_copy(update={"question": clean_question})

    # 2) 설정/시스템 프롬프트 로드
    cfg, current_model, system_prompt = await load_system_prompt(req.system_prompt)
    project_prompt = await _get_project_prompt(req.project_id)
    if project_prompt:
        system_prompt = f"{system_prompt}\n\n[프로젝트 지침]\n{project_prompt}" if system_prompt else project_prompt
    from services.project_memory import get_project_memory, project_memory_prompt_view
    project_memory = await get_project_memory(req.project_id) if req.project_id else None
    if project_memory and any(project_memory.get(key) for key in ("summary", "decisions", "action_items")):
        memory_context = json.dumps(project_memory_prompt_view(project_memory), ensure_ascii=False)
        system_prompt = f"{system_prompt}\n\n[프로젝트 메모리]\n{memory_context}" if system_prompt else f"[프로젝트 메모리]\n{memory_context}"
    request_folder_paths = await _get_request_folder_paths(req.folder_path, req.project_id)
    project_folder_context = await _build_project_folder_context(request_folder_paths)
    if project_folder_context:
        system_prompt = f"{system_prompt}\n\n{project_folder_context}" if system_prompt else project_folder_context

    # 이미지 생성 모델이면 위임
    if cfg.get("model_type") in ("image_gen", "image_edit") or current_model in IMAGE_MODEL_IDS:
        return await generate_image(ImageGenerateRequest(
            prompt=req.question, conv_id=req.conv_id,
            messages=req.messages, attachments=req.attachments,
        ))

    system_prompt = await _with_response_style(system_prompt)

    if req.voice_mode and system_prompt:
        system_prompt += VOICE_MODE_SUFFIX

    # 3) 첨부파일 분류 (분석용 context / 이미지)
    file_context_docs, image_attachments = (
        _file_attachments_to_context(req.attachments),
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
    knowledge_collection_ids = _selected_knowledge_collection_ids(req)
    external_docs: list[dict] = []
    external_instruction = ""
    inject_user_profile = True
    external_status = {"failed_sources": [], "all_failed": False, "no_results": False}
    if not req.voice_mode:
        external_docs, external_instruction, inject_user_profile, external_status = await _get_selected_external_context(
            req.question, req.external_resource_ids, req.external_document_selections,
        )
    external_selected = bool(req.external_document_selections or {GOV24_SOURCE_ID, BIZ_SUPPORT_SOURCE_ID, K_STARTUP_SOURCE_ID, HOUSING_SOURCE_ID, LH_COMPLEX_SOURCE_ID, LH_NOTICE_SOURCE_ID}.intersection(req.external_resource_ids))

    if external_status["all_failed"]:
        result = {"answer": await _external_search_failure_answer(), "sources": [], "model": await get_model_display_name()}
    elif articles:
        # 기사/문서 첨부
        from services.conv_summary import build_summary_instruction
        response_system_prompt = (system_prompt if system_prompt else FORMAT_INSTRUCTION) + build_summary_instruction(
            "", False, project_memory,
        )
        if external_instruction:
            response_system_prompt = f"{response_system_prompt}\n\n{external_instruction}"
        direct_docs, file_chunks = await search_file_id_chunks(req.question, articles)
        context_docs = limit_direct_document_contexts(file_context_docs + direct_docs + file_chunks + external_docs)
        raw_answer = await query_llm(req.question, context_docs, response_system_prompt, image_attachments,
                                     req.messages,
                                     format_instruction_override="" if req.voice_mode else None,
                                     conversation_summary=conversation_summary,
                                     reasoning=req.reasoning, call_reason="chat:article_attachment",
                                     inject_user_profile=inject_user_profile)
        result = {"answer": raw_answer, "sources": context_docs, "model": await get_model_display_name()}
    elif req.voice_mode:
        raw_answer = await query_llm(req.question, file_context_docs, system_prompt, image_attachments, req.messages,
                                     format_instruction_override="", use_tools=False,
                                     conversation_summary=conversation_summary,
                                     reasoning=req.reasoning, call_reason="chat:voice_mode")
        result = {"answer": raw_answer, "sources": [], "model": await get_model_display_name()}
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
            result = {"answer": url_error_answer, "sources": [], "model": await get_model_display_name()}
        elif url_docs:
            from services.conv_summary import build_summary_instruction
            response_system_prompt = (system_prompt if system_prompt else FORMAT_INSTRUCTION) + build_summary_instruction(
                "", False, project_memory,
            )
            if external_instruction:
                response_system_prompt = f"{response_system_prompt}\n\n{external_instruction}"
            rag_result = await rag_query(req.question, response_system_prompt, image_attachments, req.messages,
                                         extra_context=limit_direct_document_contexts(external_docs),
                                         skip_rag=external_selected and not knowledge_collection_ids,
                                         reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                         call_reason="chat:url_context", knowledge_collection_ids=knowledge_collection_ids,
                                         inject_user_profile=inject_user_profile)
            combined_docs = limit_direct_document_contexts(file_context_docs + url_docs + rag_result.get("sources", []))
            raw_answer = await query_llm(
                req.question, combined_docs, response_system_prompt,
                image_attachments, req.messages,
                format_instruction_override=None,
                conversation_summary=conversation_summary,
                reasoning=req.reasoning, call_reason="chat:url_context",
                inject_user_profile=inject_user_profile,
            )
            result = {"answer": raw_answer, "sources": combined_docs, "model": await get_model_display_name()}
        else:
            _has_file_att = any(a.get("type") in ("file", "zip") for a in req.attachments)
            from services.conv_summary import build_summary_instruction
            _summary_base_prompt = system_prompt if system_prompt else FORMAT_INSTRUCTION
            _summary_system_prompt = _summary_base_prompt + build_summary_instruction(
                "", _has_file_att, project_memory,
            )
            if external_instruction:
                _summary_system_prompt = f"{_summary_system_prompt}\n\n{external_instruction}"
            result = await rag_query(req.question, _summary_system_prompt, image_attachments, req.messages,
                                     extra_context=limit_direct_document_contexts(file_context_docs + external_docs),
                                     skip_rag=_has_file_att or (external_selected and not knowledge_collection_ids),
                                     reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                     call_reason="chat:general", knowledge_collection_ids=knowledge_collection_ids,
                                     inject_user_profile=inject_user_profile)

    # 8) 요약 태그 추출 + 히스토리 저장
    from services.conv_summary import extract_summary_tags, save_conv_summary, append_attachment_summary
    from services.project_memory import extract_project_memory_tag, merge_project_memory
    result["answer"], _project_memory = extract_project_memory_tag(result.get("answer", ""))
    _clean_answer, _conv_summary, _project_summary, _conv_title = extract_summary_tags(result["answer"])
    result["answer"] = _clean_answer

    user_ts = req.user_timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    result_sources = result.get("sources", [])
    injected_context = build_injected_context(result_sources)
    user_message = build_user_message(original_question, user_ts, req.attachments, articles)
    article_sources = filter_article_sources(result_sources)
    assistant_msg = build_assistant_message(result["answer"], result.get("model", ""), article_sources, injected_context)
    result["assistant_message"] = assistant_msg

    messages = req.messages + [user_message, assistant_msg]
    result["conv_id"] = conv_id
    generated_conversation_title = _new_conversation_title(_conv_title, _conv_summary, original_question)
    result["conversation_title"] = generated_conversation_title if not req.messages else None

    if not req.no_history:
        try:
            await save_conversation(
                conv_id, messages, title=generated_conversation_title, project_id=req.project_id or None,
            )
            if _conv_summary:
                await save_conv_summary(conv_id, _conv_summary)
            await merge_project_memory(req.project_id, conv_id, _project_memory)
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


def _tool_activity_detail(arguments: dict) -> str | None:
    """Keep persisted activity details concise and avoid exposing raw tool arguments."""
    paths = arguments.get("paths")
    if isinstance(paths, list):
        visible_paths = [str(path) for path in paths[:3]]
        hidden_count = len(paths) - len(visible_paths)
        return f"{', '.join(visible_paths)}{f' +{hidden_count}' if hidden_count > 0 else ''}" or None
    path = arguments.get("path") or arguments.get("file_path") or arguments.get("filename")
    pattern = arguments.get("pattern") or arguments.get("query")
    details = [str(value) for value in (path, pattern) if value]
    return " · ".join(details) or None


def _tool_result_activity_presentation(result: object, arguments: dict) -> dict:
    """Extract safe, compact UI metadata from a browser tool result."""
    payload = None
    if isinstance(result, str) and result.lstrip().startswith("{"):
        try:
            payload = json.loads(result)
        except json.JSONDecodeError:
            payload = None
    if not isinstance(payload, dict):
        return {"detail": _tool_activity_detail(arguments)}

    element = payload.get("element") if isinstance(payload.get("element"), dict) else {}
    detail = element.get("name") or element.get("title") or element.get("tag") or payload.get("title")
    titled_urls = []
    pages = payload.get("pages")
    if isinstance(pages, list):
        for page in pages:
            if isinstance(page, dict):
                titled_urls.append((page.get("url"), page.get("title")))
    raw_urls = [element.get("href"), payload.get("url"), arguments.get("url")]
    if isinstance(arguments.get("urls"), list):
        raw_urls.extend(arguments["urls"])
    links = []
    seen_urls = set()
    for raw_url, supplied_title in [*titled_urls, *((url, None) for url in raw_urls)]:
        if not isinstance(raw_url, str) or not raw_url.startswith(("http://", "https://")):
            continue
        parsed_url = urlparse(raw_url)
        ignored_query_keys = {
            "clickEventId", "imagePath", "searchId", "source", "sourceType", "subSourceType",
            "utm_campaign", "utm_content", "utm_id", "utm_medium", "utm_source",
        }
        query = urlencode([
            (key, value) for key, value in parse_qsl(parsed_url.query, keep_blank_values=True)
            if key not in ignored_query_keys
        ])
        url_key = parsed_url._replace(query=query, fragment="").geturl().rstrip("/")
        if url_key in seen_urls:
            continue
        seen_urls.add(url_key)
        try:
            label = str(supplied_title).strip() if supplied_title else (urlparse(raw_url).hostname or raw_url)
        except ValueError:
            label = raw_url
        links.append({"label": label, "url": raw_url})
    return {
        "detail": str(detail)[:200] if detail else (None if links else _tool_activity_detail(arguments)),
        "links": links or None,
    }


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

    _log_user_query(req.question)

    async def stream():
        mcp_scope_token = None
        approval_context_token = None
        _saved = False
        try:
            approval_context_token = current_approval_context.set(ApprovalContext(
                mode=req.approval_mode, conversation_id=req.conv_id, project_id=req.project_id,
                interactive=True,
            ))
            if req.selected_mcp_ids and not req.minimal_prompt:
                from services.mcp_client import mcp_manager
                mcp_scope_token = await mcp_manager.enable_request_scope(req.selected_mcp_ids)
            # user 발화 시각을 요청 도착 시점으로 고정 (프론트가 전송 시각을 주면 우선 사용)
            user_ts = req.user_timestamp or datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")

            # 1) 붙여넣기 UI 마커 제거 (본문은 사용자 질문으로 유지)
            original_question = req.question
            clean_question = unwrap_pasted_text(req.question)

            # 2) 설정/시스템 프롬프트 로드
            if req.minimal_prompt:
                cfg = await load_config_async()
                current_model = cfg.get("model", "")
                system_prompt = req.system_prompt
            else:
                cfg, current_model, system_prompt = await load_system_prompt(req.system_prompt)
            project_memory = None
            request_folder_paths: list[str] = []
            if not req.minimal_prompt:
                project_prompt = await _get_project_prompt(req.project_id)
                if project_prompt:
                    system_prompt = f"{system_prompt}\n\n[프로젝트 지침]\n{project_prompt}" if system_prompt else project_prompt
                from services.project_memory import get_project_memory, project_memory_prompt_view
                project_memory = await get_project_memory(req.project_id) if req.project_id else None
                if project_memory and any(project_memory.get(key) for key in ("summary", "decisions", "action_items")):
                    memory_context = json.dumps(project_memory_prompt_view(project_memory), ensure_ascii=False)
                    system_prompt = f"{system_prompt}\n\n[프로젝트 메모리]\n{memory_context}" if system_prompt else f"[프로젝트 메모리]\n{memory_context}"
                request_folder_paths = await _get_request_folder_paths(req.folder_path, req.project_id)
                project_folder_context = await _build_project_folder_context(request_folder_paths)
                if project_folder_context:
                    system_prompt = f"{system_prompt}\n\n{project_folder_context}" if system_prompt else project_folder_context
                system_prompt = await _with_response_style(system_prompt)

            # 3) 첨부파일 분류
            file_context_docs = _file_attachments_to_context(req.attachments)
            image_attachments = [a for a in req.attachments if a.get("type") == "image"]

            # conv_id를 여기서 미리 확정한다.
            conv_id = req.conv_id or str(uuid.uuid4())
            from services.conv_summary import get_prior_conv_summary
            conversation_summary = "" if req.minimal_prompt else await get_prior_conv_summary(conv_id)

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
            display_model = await get_model_display_name()

            # 이전 assistant의 article_sources에서 file_id 승계
            articles = resolve_selected_articles(
                req.articles,
                req.messages,
                selection_explicit=req.article_selection_explicit,
            )

            # 질문에 포함된 URL 중 크롤링 대상 추출
            all_urls = [u.rstrip('.') for u in URL_RE.findall(clean_question)]
            urls = _should_crawl_urls(clean_question, all_urls) if not req.minimal_prompt and has_plugin_url_resolvers() else []

            context_docs: list[dict] = []
            can_stream = False  # True면 아래 "실제 토큰 스트리밍"으로, False면 (C)/(D) 처리
            selected_external_instruction = ""
            inject_user_profile = not req.minimal_prompt

            config = await load_config_async()
            is_image_model = config.get("model_type") in ("image_gen", "image_edit") or model in IMAGE_MODEL_IDS
            knowledge_collection_ids = [] if req.minimal_prompt else _selected_knowledge_collection_ids(req)
            external_selected = bool(req.external_document_selections or {GOV24_SOURCE_ID, BIZ_SUPPORT_SOURCE_ID, K_STARTUP_SOURCE_ID, HOUSING_SOURCE_ID, LH_COMPLEX_SOURCE_ID, LH_NOTICE_SOURCE_ID}.intersection(req.external_resource_ids))
            external_docs: list[dict] = []
            external_instruction = ""
            external_status = {"failed_sources": [], "all_failed": False, "no_results": False}
            if not req.minimal_prompt and not is_image_model and not req.voice_mode:
                external_docs, external_instruction, inject_user_profile, external_status = await _get_selected_external_context(
                    clean_question, req.external_resource_ids, req.external_document_selections,
                )
            if external_status["all_failed"]:
                error_message = await _external_search_failure_answer()
                yield _sse("meta", {"model": display_model, "sources": []})
                yield _sse("token", {"text": error_message})
                yield _sse("done", {"conv_id": req.conv_id or "", "answer": error_message})
                return

            if not is_image_model and not req.voice_mode and articles:
                # ══ 경로 (A): 기사/문서 첨부 ══
                direct_docs, file_chunks = await search_file_id_chunks(clean_question, articles)
                context_docs = file_context_docs + direct_docs + file_chunks + external_docs
                docs_for_llm = limit_direct_document_contexts(context_docs)
                selected_external_instruction = external_instruction
                can_stream = True

            elif not is_image_model and not req.voice_mode and urls:
                # ══ 경로 (B): URL 크롤링 ══
                targets = urls[:3]
                tasks = [resolve_url_content(u) for u in targets]
                results_url = await asyncio.gather(*tasks)
                url_errors = _get_url_context_errors(results_url)

                if url_errors:
                    error_message = _format_url_context_error(url_errors)
                    yield _sse("meta", {"model": display_model, "sources": []})
                    yield _sse("token", {"text": error_message})
                    yield _sse("done", {"conv_id": req.conv_id or "", "answer": error_message})
                    return

                url_docs = [result for result in results_url if result]
                if url_docs:
                    # URL 컨텍스트를 얻은 경우에만 본문을 추가한다. 실패한 URL은 원문 질문에
                    # 그대로 남으므로, 컨텍스트 없이 일반 채팅 경로로 LLM에 전달된다.
                    url_system_prompt = system_prompt
                    if external_instruction:
                        url_system_prompt = f"{url_system_prompt}\n\n{external_instruction}"
                    rag_result = await rag_query(clean_question, url_system_prompt, image_attachments, req.messages,
                                                 extra_context=limit_direct_document_contexts(external_docs),
                                                 skip_rag=external_selected and not knowledge_collection_ids,
                                                 reasoning=req.reasoning, conv_id=conv_id, conversation_summary=conversation_summary,
                                                 call_reason="chat:url_context_stream",
                                                 knowledge_collection_ids=knowledge_collection_ids,
                                                 inject_user_profile=inject_user_profile)
                    context_docs = file_context_docs + url_docs + rag_result.get("sources", [])
                    docs_for_llm = limit_direct_document_contexts(context_docs)
                    selected_external_instruction = external_instruction
                    can_stream = True

            if not can_stream:
                # ══ 경로 (C): 이미지 생성 / voice_mode — 스트리밍 미지원 ══
                # 논스트리밍 /query 로 위임하고 전체 답변을 token 1회 + done 으로 방출
                if is_image_model or req.voice_mode:
                    result = await query(req)
                    yield _sse("meta", {"model": result.get("model", display_model), "sources": result.get("sources", [])})
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
                # minimal_prompt 요청은 클라이언트가 보낸 system_prompt를 그대로 쓰며,
                # 백엔드 포맷·요약 지시를 일절 덧붙이지 않는다.
                if req.minimal_prompt:
                    _summary_system_prompt = system_prompt
                    _fmt_override = ""
                else:
                    from services.conv_summary import build_summary_instruction
                    _summary_base_prompt = system_prompt if system_prompt else FORMAT_INSTRUCTION
                    _summary_system_prompt = _summary_base_prompt + build_summary_instruction(
                        "", has_file_attachment, project_memory,
                    )
                    _fmt_override = None
                if external_instruction:
                    _summary_system_prompt = f"{_summary_system_prompt}\n\n{external_instruction}"

                # 모든 등록 폴더를 ID로 노출한다. 코드 도구는 매 호출마다 folder_id를 요구한다.
                if request_folder_paths:
                    from services.code_tools import (
                        build_code_folder_map,
                        current_code_folder,
                        current_code_folders,
                        current_code_question,
                    )
                    current_code_folders.set(build_code_folder_map(request_folder_paths))
                    current_code_folder.set(request_folder_paths[0])
                    current_code_question.set(clean_question)
                    from services.code_tools import begin_code_change_tracking
                    begin_code_change_tracking()

                from services.conv_summary import HiddenMetadataStreamFilter
                metadata_stream_filter = HiddenMetadataStreamFilter()
                _tool_messages: list[dict] = []  # tool call/result 메시지 수집
                _activity_log: list[dict] = []
                project_tool_first = bool(request_folder_paths)
                logger.info(
                    "[query_stream] RAG routing: project_tool_first=%s folder_count=%d",
                    project_tool_first, len(request_folder_paths),
                )
                async for ev in rag_query_stream(
                        clean_question, _summary_system_prompt, image_attachments, req.messages,
                        extra_context=limit_direct_document_contexts(file_context_docs + external_docs),
                        skip_rag=req.minimal_prompt or has_file_attachment or (external_selected and not knowledge_collection_ids),
                        reasoning=req.reasoning,
                        conv_id=conv_id,
                        conversation_summary="" if req.minimal_prompt else conversation_summary,
                        format_instruction_override=_fmt_override,
                        call_reason="chat:general_stream",
                        knowledge_collection_ids=knowledge_collection_ids,
                        inject_user_profile=inject_user_profile,
                        project_tool_first=project_tool_first,
                        use_tools=not req.minimal_prompt,
                        include_skills=not req.minimal_prompt,
                        isolated_system_prompt=req.minimal_prompt,
                ):
                    if ev["type"] == "token":
                        emitted += ev["text"]
                        visible_text = metadata_stream_filter.feed(ev["text"])
                        if visible_text:
                            yield _sse("token", {"text": visible_text})
                    elif ev["type"] == "reset":
                        # relay된 서두를 프론트에서 지우도록 지시 (뒤늦은 tool 호출 케이스)
                        emitted = ""
                        metadata_stream_filter = HiddenMetadataStreamFilter()
                        _tool_messages.clear()
                        _activity_log.clear()
                        yield _sse("reset", {})
                    elif ev["type"] == "tool":
                        _phase = ev.get("phase")
                        _tool_name = ev.get("name", "")
                        if _phase in {"start", "approval_required"} and _tool_name:
                            started_at = int(datetime.now(timezone.utc).timestamp() * 1000)
                            if (_phase == "start" and _activity_log
                                    and _activity_log[-1].get("phase") == "running"
                                    and _activity_log[-1].get("name") == _tool_name):
                                _activity_log[-1]["startedAt"] = started_at
                            else:
                                _activity_log.append({
                                    "phase": "running", "name": _tool_name, "label": _tool_name,
                                    "group": "code" if _tool_name.split("__")[-1].startswith("code_") else "tool",
                                    "detail": _tool_activity_detail(ev.get("args", {})),
                                    "startedAt": started_at,
                                })
                        elif _phase == "approval_rejected" and _activity_log:
                            _activity_log.pop()
                        elif _phase == "end" and _activity_log:
                            _activity_log[-1]["phase"] = "completed"
                            _result = ev.get("result")
                            _activity_log[-1]["outcome"] = (
                                "failed" if isinstance(_result, str) and tool_result_failed(_result) else "success"
                            )
                            _activity_log[-1]["completedAt"] = int(datetime.now(timezone.utc).timestamp() * 1000)
                            _presentation = _tool_result_activity_presentation(_result, ev.get("args", {}))
                            if _presentation.get("detail"):
                                _activity_log[-1]["detail"] = _presentation["detail"]
                            if _presentation.get("links"):
                                _activity_log[-1]["links"] = _presentation["links"]
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
                    elif ev["type"] == "error":
                        yield _sse("error", {
                            "code": ev.get("code"),
                            "model": ev.get("model"),
                        })
                        return
                    elif ev["type"] == "final":
                        final_result = ev["result"]

                trailing_visible_text = metadata_stream_filter.finish()
                if trailing_visible_text:
                    yield _sse("token", {"text": trailing_visible_text})

                answer = final_result.get("answer", emitted).strip()
                gen_sources = final_result.get("sources", []) or []
                gen_model = final_result.get("model", display_model)
                gen_stats = final_result.get("stats")
                response_truncated = bool(final_result.get("truncated"))
                yield _sse("meta", {"model": gen_model, "sources": gen_sources})

                # 답변에서 <conv_summary>/<project_summary> 숨김 태그 추출 후 제거 (사용자에겐 안 보임).
                # 정규식 처리라 빠르므로 done 이벤트 전에 해도 지연 없음 — done에 실릴 answer는 이 clean 버전이어야 함.
                from services.conv_summary import extract_summary_tags, save_conv_summary, append_attachment_summary
                from services.project_memory import extract_project_memory_tag, merge_project_memory
                answer, _project_memory = extract_project_memory_tag(answer)
                answer, _conv_summary, _project_summary, _conv_title = extract_summary_tags(answer)
                conversation_title = _new_conversation_title(_conv_title, _conv_summary, original_question)

                injected_context = build_injected_context(gen_sources)
                from services.code_tools import finalize_code_change_tracking
                code_changes = finalize_code_change_tracking()
                user_message = build_user_message(original_question, user_ts, req.attachments)
                # "참고" 표시용 — url이 있는 소스만
                article_sources = [s for s in gen_sources if s.get("url") and s.get("source") != "붙여넣기"]
                assistant_msg = build_assistant_message(
                    answer, gen_model, article_sources, injected_context, gen_stats, _activity_log,
                    code_changes=code_changes,
                    truncated=response_truncated,
                )

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
                                conversation_title,
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
                            await merge_project_memory(req.project_id, conv_id, _project_memory)
                            # project_summary(LLM 요약)가 없어도 배치 메타정보는 항상 남긴다 (요약은 폴백 문구)
                            # (인덱싱 자체는 이미 함수 앞부분에서 LLM 호출과 병렬로 시작됨 — 여기서 다시 트리거하지 않는다)
                            for _batch in _early_chat_file_batches:
                                await append_attachment_summary(
                                    conv_id, _project_summary, _batch["source_name"], _batch["file_count"], _batch["batch_id"],
                                )
                        except Exception as e:
                            logger.warning("[query_stream] 히스토리 저장 실패(일반채팅, 백그라운드): %s", e)

                    _run_in_background(_save_history_bg())

                yield _sse("done", {"conv_id": conv_id, "answer": answer, "stats": gen_stats,
                                    "truncated": response_truncated, "code_changes": code_changes,
                                    "conversation_title": conversation_title if not req.messages else None})
                _saved = True
                return

            # ── 실제 토큰 스트리밍 (경로 A·B: 문서/URL context 기반, tool 미사용) ──
            yield _sse("meta", {"model": display_model, "sources": context_docs})

            from services.conv_summary import HiddenMetadataStreamFilter
            metadata_stream_filter = HiddenMetadataStreamFilter()
            parts: list[str] = []
            stats: dict | None = None
            finish_reason: str | None = None
            selected_docs_system_prompt = system_prompt
            if not req.voice_mode and not req.minimal_prompt:
                from services.conv_summary import build_summary_instruction
                selected_docs_system_prompt = (system_prompt if system_prompt else FORMAT_INSTRUCTION) + build_summary_instruction(
                    "", False, project_memory,
                )
            if selected_external_instruction:
                selected_docs_system_prompt = f"{selected_docs_system_prompt}\n\n{selected_external_instruction}"
            # 선택된 문서/기사/URL 기반 질의 — 답은 이 context 안에서 나오므로 tool 판정 불필요
            async for ev in chat_stream_with_tools(
                    clean_question, docs_for_llm, selected_docs_system_prompt, image_attachments, req.messages,
                    format_instruction_override="" if req.voice_mode or req.minimal_prompt else None,
                    conversation_summary="" if req.minimal_prompt else conversation_summary,
                    use_tools=False,
                    reasoning=req.reasoning,
                    call_reason="chat:selected_docs",
                    inject_user_profile=inject_user_profile,
                    include_skills=not req.minimal_prompt,
                    isolated_system_prompt=req.minimal_prompt,
            ):
                if ev.get("type") == "token":
                    token_text = ev.get("text", "")
                    parts.append(token_text)
                    visible_text = metadata_stream_filter.feed(token_text)
                    if visible_text:
                        yield _sse("token", {"text": visible_text})
                elif ev.get("type") == "tool":
                    yield _sse("tool", ev)
                elif ev.get("type") == "stats":
                    stats = {k: v for k, v in ev.items() if k != "type"}
                elif ev.get("type") == "finish":
                    finish_reason = ev.get("reason")
                elif ev.get("type") == "error":
                    yield _sse("error", {
                        "code": ev.get("code"),
                        "model": ev.get("model"),
                    })
                    return

            trailing_visible_text = metadata_stream_filter.finish()
            if trailing_visible_text:
                yield _sse("token", {"text": trailing_visible_text})

            answer = "".join(parts).strip()
            from services.conv_summary import extract_summary_tags, save_conv_summary
            from services.project_memory import extract_project_memory_tag, merge_project_memory
            answer, _project_memory = extract_project_memory_tag(answer)
            answer, _conv_summary, _, _conv_title = extract_summary_tags(answer)
            conversation_title = _new_conversation_title(_conv_title, _conv_summary, original_question)

            # ── 히스토리 저장 (공통 헬퍼 사용) ──
            injected_context = build_injected_context(context_docs)
            user_message = build_user_message(original_question, user_ts, req.attachments, articles)
            article_sources = filter_article_sources(context_docs)
            response_truncated = finish_reason == "length"
            assistant_msg = build_assistant_message(
                answer, model, article_sources, injected_context, stats, truncated=response_truncated,
            )

            if not req.no_history:
                try:
                    await save_conversation(
                        conv_id, req.messages + [user_message, assistant_msg],
                        title=conversation_title, project_id=req.project_id or None,
                    )
                    if _conv_summary:
                        await save_conv_summary(conv_id, _conv_summary)
                    await merge_project_memory(req.project_id, conv_id, _project_memory)
                except Exception as e:
                    logger.warning("[query_stream] 히스토리 저장 실패: %s", e)
            _saved = True

            yield _sse("done", {"conv_id": conv_id, "answer": answer, "stats": stats,
                                "truncated": response_truncated,
                                "conversation_title": conversation_title if not req.messages else None})
        except (asyncio.CancelledError, GeneratorExit):
            logger.info("[query_stream] 클라이언트 연결 종료 — 스트림 중단")
        finally:
            if approval_context_token is not None:
                current_approval_context.reset(approval_context_token)
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
                                     "timestamp": now, "model": display_model if 'display_model' in dir() else ""})
                    _run_in_background(save_conversation(conv_id, msgs))
                except Exception as e:
                    logger.warning("[query_stream] 중단 시 저장 실패: %s", e)

    return StreamingResponse(stream(), media_type="text/event-stream")


class UndoCodeChangesRequest(BaseModel):
    undo_token: str
    folder_id: str | None = None
    path: str | None = None


@router.post("/code-changes/undo")
async def undo_code_change_transaction(req: UndoCodeChangesRequest):
    from services.code_tools import undo_code_changes
    result = undo_code_changes(req.undo_token, req.folder_id, req.path)
    if not result.get("ok"):
        status_code = 409 if result.get("reason") == "conflict" else 400 if result.get("reason") == "invalid_target" else 404
        raise HTTPException(status_code=status_code, detail=result)
    return result


@router.get("/code-changes/undo/{undo_token}/status")
async def code_change_undo_status(undo_token: str):
    from services.code_tools import get_code_changes_undo_status
    return get_code_changes_undo_status(undo_token)


# ── 번역 전용 엔드포인트 (RAG/도구 호출 없이 LLM 1회만 호출) ──────────────────
class TranslateRequest(BaseModel):
    text: str
    target_lang: str  # "영어" | "한국어" 등
    instruction: str = ""  # 커스텀 지시문 (있으면 기본 프롬프트 대신 사용)
    include_response_language: bool = True  # 사용자 UI 언어 응답 규칙 포함 여부
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
        gen_stats: dict = {}  # query_llm이 provider 토큰수/처리시간 통계를 채움
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
            include_response_language=req.include_response_language,
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
