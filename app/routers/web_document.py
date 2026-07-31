"""사용자가 명시적으로 저장한 웹 문서의 로컬 인덱싱 API."""
import asyncio
import hashlib
import json
import re
from datetime import datetime, timezone
from urllib.parse import urlparse

from elasticsearch.helpers import async_bulk
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

from services.db import DOCUMENT_ORIGINALS_INDEX, WEB_DOCUMENTS_INDEX, WEB_DOC_CHUNKS_INDEX, get_es, get_language_index
from services.embedding_runtime import get_embeddings
from services.knowledge_collection_references import remove_source_references_from_collections
from services.language_detection import detect_language
from logger import get_logger

router = APIRouter()
logger = get_logger(__name__)

MAX_WEB_CONTENT_CHARS = 30_000
WEB_CHUNK_SIZE = 2_400
WEB_CHUNK_OVERLAP = 250
EMBED_BATCH_SIZE = 4


class WebDocumentIndexRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4_096)
    title: str = Field(min_length=1, max_length=1_024)
    content: str = Field(min_length=1, max_length=MAX_WEB_CONTENT_CHARS)
    published_at: str | None = Field(default=None, max_length=64)


class WebDocumentAnalyzeRequest(BaseModel):
    url: str = Field(min_length=1, max_length=4_096)
    title: str = Field(default="", max_length=1_024)
    content: str = Field(min_length=1, max_length=MAX_WEB_CONTENT_CHARS)


def _document_id(url: str) -> str:
    return hashlib.sha256(url.encode("utf-8")).hexdigest()


def _chunks(content: str) -> list[str]:
    normalized = re.sub(r"\n{3,}", "\n\n", content).strip()
    if not normalized:
        return []
    chunks: list[str] = []
    start = 0
    while start < len(normalized):
        end = min(len(normalized), start + WEB_CHUNK_SIZE)
        if end < len(normalized):
            boundary = max(normalized.rfind("\n", start + WEB_CHUNK_SIZE // 2, end), normalized.rfind(". ", start + WEB_CHUNK_SIZE // 2, end))
            if boundary > start:
                end = boundary + 1
        chunks.append(normalized[start:end].strip())
        if end >= len(normalized):
            break
        overlap_target = max(end - WEB_CHUNK_OVERLAP, start + 1)
        # 고정 문자 수 오버랩은 다음 청크를 단어 한가운데서 시작시킬 수 있다.
        # 목표 지점 직전의 가장 가까운 문장·문단 경계로 되돌려 문맥을 온전히 유지한다.
        boundary_search_start = max(start + 1, overlap_target - WEB_CHUNK_OVERLAP)
        paragraph_boundary = normalized.rfind("\n\n", boundary_search_start, overlap_target)
        sentence_boundary = max(
            normalized.rfind(". ", boundary_search_start, overlap_target),
            normalized.rfind("? ", boundary_search_start, overlap_target),
            normalized.rfind("! ", boundary_search_start, overlap_target),
        )
        if paragraph_boundary >= sentence_boundary and paragraph_boundary >= boundary_search_start:
            start = paragraph_boundary + 2
        elif sentence_boundary >= boundary_search_start:
            start = sentence_boundary + 2
        else:
            start = overlap_target
    return [chunk for chunk in chunks if chunk]


async def _index_document(request: WebDocumentIndexRequest, emit) -> dict:
    url = request.url.strip()
    title = request.title.strip()
    content = request.content.strip()
    if not url or not content:
        raise HTTPException(status_code=422, detail="웹 문서 내용이 비어 있습니다.")

    document_id = _document_id(url)
    now = datetime.now(timezone.utc).isoformat()
    parsed_url = urlparse(url)
    domain = parsed_url.netloc
    chunks = _chunks(content)
    if not chunks:
        raise HTTPException(status_code=422, detail="인덱싱할 본문을 찾을 수 없습니다.")

    await emit("chunking", 20, {"total_chunks": len(chunks)})
    es = get_es()
    try:
        existing = bool(await es.exists(index=WEB_DOCUMENTS_INDEX, id=document_id))
        if existing:
            await emit("replacing", 25, None)
            await es.delete_by_query(
                index=WEB_DOC_CHUNKS_INDEX,
                query={"term": {"web_document_id": document_id}},
                refresh=True,
            )

        await emit("embedding", 30, {"total_chunks": len(chunks), "processed_chunks": 0})
        indexed = 0
        for start in range(0, len(chunks), EMBED_BATCH_SIZE):
            batch = chunks[start:start + EMBED_BATCH_SIZE]
            embeddings = await get_embeddings([f"{title}\n\n{chunk}" for chunk in batch])
            actions = []
            for offset, (chunk, embedding) in enumerate(zip(batch, embeddings)):
                chunk_index = start + offset
                language = detect_language(chunk)
                chunk_id = hashlib.sha256(f"{document_id}:{chunk_index}".encode()).hexdigest()
                action = {
                    "_index": get_language_index("web_doc_chunks", language),
                    "_id": chunk_id,
                    "id": chunk_id,
                    "title": title,
                    "content": chunk,
                    "url": url,
                    "source": "web",
                    "created_at": now,
                    "updated_at": now,
                    "indexed_at": now,
                    "content_language": language,
                    "web_document_id": document_id,
                    "chunk_index": chunk_index,
                    "total_chunks": len(chunks),
                    "content_length": len(chunk),
                    "embedding_model": "ggml-org/bge-m3-Q8_0-GGUF",
                }
                if embedding:
                    action["embedding"] = embedding
                actions.append(action)
            success, _ = await async_bulk(es, actions, refresh=False)
            indexed += success
            processed = min(start + len(batch), len(chunks))
            await emit("indexing_chunks", 30 + int(processed / len(chunks) * 60), {
                "total_chunks": len(chunks), "processed_chunks": processed, "indexed_chunks": indexed,
            })

        await es.indices.refresh(index=WEB_DOC_CHUNKS_INDEX)
        await emit("saving_metadata", 93, None)
        existing_source = (await es.get(index=WEB_DOCUMENTS_INDEX, id=document_id))["_source"] if existing else {}
        await es.index(index=WEB_DOCUMENTS_INDEX, id=document_id, document={
            "id": document_id, "url": url, "title": title, "domain": domain,
            "content": content,
            "published_at": request.published_at or None,
            "saved_at": existing_source.get("saved_at", now), "updated_at": now,
            "chunk_count": indexed, "source_type": "web",
        }, refresh=True)
        await es.index(index=DOCUMENT_ORIGINALS_INDEX, id=document_id, document={
            "document_id": document_id, "source_type": "web", "title": title,
            "content": content, "url": url, "file_ext": "web",
            "content_length": len(content),
            "created_at": existing_source.get("saved_at", now), "updated_at": now,
        }, refresh=True)
        return {"web_document_id": document_id, "title": title, "url": url, "chunk_count": indexed, "updated": existing}
    finally:
        try:
            await es.close()
        except Exception as error:
            # 저장과 인덱싱이 완료된 뒤 연결 종료가 실패해도 결과를 실패로 바꾸지 않는다.
            logger.warning("웹 문서 인덱싱 후 ES 연결 종료 실패: %s", error)


@router.post("/web-documents/index-progress")
async def index_web_document_progress(request: WebDocumentIndexRequest):
    async def event_stream():
        async def emit(stage: str, percent: int, details: dict | None = None):
            yield_data = {"type": "progress", "stage": stage, "percent": percent, **(details or {})}
            events.append(yield_data)

        events: list[dict] = []
        try:
            async def progress(stage: str, percent: int, details: dict | None = None):
                await emit(stage, percent, details)

            task = asyncio.create_task(_index_document(request, progress))
            while not task.done() or events:
                while events:
                    yield json.dumps(events.pop(0), ensure_ascii=False) + "\n"
                if not task.done():
                    await asyncio.sleep(0.05)
            result = await task
            yield json.dumps({"type": "result", **result}, ensure_ascii=False) + "\n"
        except HTTPException as error:
            yield json.dumps({"type": "error", "message": error.detail}, ensure_ascii=False) + "\n"
        except Exception as error:
            logger.exception("웹 문서 인덱싱 실패: %s", error)
            yield json.dumps({"type": "error", "message": "웹 문서 저장에 실패했습니다."}, ensure_ascii=False) + "\n"

    return StreamingResponse(event_stream(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/web-documents/analyze")
async def analyze_web_document(request: WebDocumentAnalyzeRequest):
    """LLM으로 페이지 노이즈를 제거하고 저장용 메타데이터를 정규화한다."""
    from services.llm.core import query_llm

    instruction = """Extract one web document from the supplied page text. Remove navigation, cookie notices, advertisements, related links and repeated boilerplate. Return JSON only with title, content, published_at. published_at must be an ISO-8601 date or null. Do not invent a publication date. Keep the article/document body faithful to the source."""
    try:
        answer = await query_llm(
            instruction,
            [{"title": request.title or request.url, "content": request.content, "url": request.url, "source": "web"}],
            format_instruction_override="", use_tools=False, reasoning=False, inject_user_profile=False,
            include_skills=False, call_reason="web_document:analyze",
        )
        match = re.search(r"\{[\s\S]*\}", answer)
        payload = json.loads(match.group(0) if match else answer)
        title = str(payload.get("title") or request.title or request.url).strip()
        content = str(payload.get("content") or request.content).strip()[:MAX_WEB_CONTENT_CHARS]
        published_at = payload.get("published_at")
        if published_at is not None and not isinstance(published_at, str):
            published_at = None
        return {"title": title, "content": content, "published_at": published_at}
    except Exception as error:
        raise HTTPException(status_code=502, detail="웹 문서 분석에 실패했습니다.") from error


@router.get("/web-documents")
async def list_web_documents():
    es = get_es()
    try:
        response = await es.search(index=WEB_DOCUMENTS_INDEX, size=200, sort=[{"updated_at": {"order": "desc"}}])
        return {"documents": [{**hit["_source"], "web_document_id": hit["_id"]} for hit in response["hits"]["hits"]]}
    finally:
        await es.close()


@router.delete("/web-documents/{document_id}")
async def delete_web_document(document_id: str):
    es = get_es()
    try:
        try:
            document = await es.get(index=WEB_DOCUMENTS_INDEX, id=document_id)
        except Exception:
            raise HTTPException(status_code=404, detail="웹 문서를 찾을 수 없습니다.")
        deleted = await es.delete_by_query(index=WEB_DOC_CHUNKS_INDEX, query={"term": {"web_document_id": document_id}}, refresh=True)
        await es.delete(index=WEB_DOCUMENTS_INDEX, id=document_id, refresh=True)
        if bool(await es.exists(index=DOCUMENT_ORIGINALS_INDEX, id=document_id)):
            await es.delete(index=DOCUMENT_ORIGINALS_INDEX, id=document_id, refresh=True)
        collections_updated = await remove_source_references_from_collections(es, "web", [document_id])
        return {"deleted": document["_source"].get("title", document_id), "chunks_deleted": deleted.get("deleted", 0), "collections_updated": collections_updated}
    finally:
        await es.close()
