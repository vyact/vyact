"""
document.py – 문서 업로드 라우터
POST /api/document/parse          → 파싱만 (즉시 질의용)
POST /api/document/index          → 파싱 + ES 인덱싱 + 원본 저장 + rag_files 메타
GET  /api/document/files          → 저장된 파일 목록 (rag_files 기준)
GET  /api/document/files/{file_id} → 원본 파일 다운로드
DELETE /api/document/files/{file_id} → 원본 파일 + ES 청크 삭제
"""
import asyncio
import hashlib
import io
import json
import shutil
import tempfile
import uuid
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Awaitable, Callable

from fastapi import APIRouter, HTTPException, UploadFile, File
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel, Field

from config import INSTALL_DIR
from logger import get_logger
from services.document_parser import Chunk, parse_file, parse_file_to_chunks, parse_file_to_typed_chunks
from services.indexer import get_embedding
from elasticsearch.helpers import async_bulk
from services.db import DOCUMENT_ORIGINALS_INDEX, INDEX_NAME, DOC_CHUNKS_INDEX, FILES_INDEX, WEB_DOCUMENTS_INDEX, WEB_DOC_CHUNKS_INDEX, get_es, get_language_index
from services.language_detection import detect_language
from services.knowledge_collection_references import remove_source_references_from_collections

logger = get_logger(__name__)
router = APIRouter()

DOCS_DIR = INSTALL_DIR / "documents"
DOCS_DIR.mkdir(parents=True, exist_ok=True)

ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".pptx", ".txt", ".html", ".htm", ".md"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB
MAX_SAVED_FILES = 1000
DOCUMENT_EMBED_BATCH_SIZE = 4


class SelectedDocumentsDownloadRequest(BaseModel):
    file_ids: list[str] = Field(min_length=1, max_length=MAX_SAVED_FILES)


def _validate(file: UploadFile):
    ext = Path(file.filename or "").suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"지원하지 않는 형식: {ext}")


async def _save_temp(file: UploadFile) -> Path:
    ext = Path(file.filename or "file").suffix.lower()
    tmp = Path(tempfile.mktemp(suffix=ext))
    content = await file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="파일 크기가 50MB를 초과합니다.")
    tmp.write_bytes(content)
    return tmp


# ─────────────────────────────
# POST /api/document/parse
# ─────────────────────────────

@router.post("/document/parse")
async def parse_document(file: UploadFile = File(...), max_chars: int = 0):
    """파싱만 수행 → 텍스트 반환 (즉시 질의 모드)
    max_chars: 0이면 전체, 양수면 해당 글자수까지 잘라서 반환
    """
    _validate(file)
    tmp = await _save_temp(file)
    try:
        text = parse_file(tmp)
        if not text.strip():
            raise HTTPException(status_code=422, detail="문서에서 텍스트를 추출할 수 없습니다.")
        truncated = False
        if max_chars > 0 and len(text) > max_chars:
            text = text[:max_chars]
            truncated = True
        return {
            "filename": file.filename,
            "content": text,
            "length": len(text),
            "truncated": truncated,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("parse 실패 [%s]: %s", file.filename, e)
        raise HTTPException(status_code=500, detail=f"파싱 실패: {e}")
    finally:
        tmp.unlink(missing_ok=True)


# ─────────────────────────────
# POST /api/document/index
# ─────────────────────────────

def _sample_hash(data: bytes) -> str:
    """파일 전체를 읽지 않고 앞/중간/끝 64KB + 파일 크기로 샘플 해시 생성"""
    size = len(data)
    SAMPLE = 64 * 1024  # 64KB
    mid = size // 2
    parts = (
            data[:SAMPLE]
            + data[max(0, mid - SAMPLE // 2): mid + SAMPLE // 2]
            + data[max(0, size - SAMPLE):]
            + str(size).encode()
    )
    return hashlib.md5(parts).hexdigest()


ProgressCallback = Callable[[str, int, dict | None], Awaitable[None]]


async def _noop_progress(_stage: str, _percent: int, _details: dict | None = None) -> None:
    return None


async def _index_saved_document(
    tmp: Path,
    filename: str,
    progress: ProgressCallback = _noop_progress,
) -> dict:
    """임시 파일을 인덱싱하고 처리 단계별 진행 상황을 콜백으로 전달한다."""
    file_id = str(uuid.uuid4())
    await progress("checking_duplicate", 5, None)

    file_bytes = tmp.read_bytes()
    content_hash = _sample_hash(file_bytes)
    es = get_es()
    try:
        dup_res = await es.search(
            index=FILES_INDEX,
            query={"term": {"content_hash": content_hash}},
            size=1,
            _source=["file_id", "filename", "chunk_count"],
        )
        hits = dup_res["hits"]["hits"]
        if hits:
            existing = hits[0]["_source"]
            result = {
                "file_id": existing["file_id"],
                "filename": existing["filename"],
                "chunks": existing.get("chunk_count", 0),
                "total_chunks": existing.get("chunk_count", 0),
                "indexed_chunks": existing.get("chunk_count", 0),
                "already_exists": True,
            }
            await progress("duplicate", 100, result)
            return result
    except Exception:
        pass  # 중복 체크 실패 시 그냥 진행
    finally:
        await es.close()

    await progress("chunking", 15, None)
    typed_chunks = await asyncio.to_thread(parse_file_to_typed_chunks, tmp)
    if not typed_chunks:
        raise HTTPException(status_code=422, detail="문서에서 텍스트를 추출할 수 없습니다.")
    await progress("chunking", 30, {"chunks": len(typed_chunks)})
    # 채팅 직접 첨부용 원문은 검색 청크를 다시 합치지 않는다. 표 헤더/섹션 문맥이
    # 청크마다 반복될 수 있기 때문에, 파서가 추출한 전체 텍스트를 별도로 보관한다.
    original_text = (await asyncio.to_thread(parse_file, tmp)).strip()
    if not original_text:
        raise HTTPException(status_code=422, detail="문서에서 텍스트를 추출할 수 없습니다.")

    ext = Path(filename).suffix.lower()
    dest = DOCS_DIR / f"{file_id}{ext}"
    await progress("saving_original", 40, None)
    await asyncio.to_thread(shutil.copy2, tmp, dest)
    logger.info("원본 저장: %s → %s", filename, dest.name)

    es = get_es()
    indexed = 0
    indexed_at = datetime.now(timezone.utc).isoformat()
    try:
        def _embed_text(chunk: Chunk) -> str:
            if chunk.chunk_type == "table" and "[검색용]" in chunk.text:
                search_part = chunk.text.split("[검색용]", 1)[1].strip()
                return f"{filename}\n{search_part}" if search_part else f"{filename}\n{chunk.text}"
            return f"{filename}\n{chunk.text}"

        total_chunks = len(typed_chunks)
        await progress("embedding", 50, {
            "chunks": total_chunks,
            "total_chunks": total_chunks,
            "embedded_chunks": 0,
        })
        embedded_chunks = 0
        for start in range(0, total_chunks, DOCUMENT_EMBED_BATCH_SIZE):
            batch_chunks = typed_chunks[start:start + DOCUMENT_EMBED_BATCH_SIZE]
            batch_embeddings = await asyncio.gather(*[
                get_embedding(_embed_text(chunk))
                for chunk in batch_chunks
            ])
            embedded_chunks += sum(embedding is not None for embedding in batch_embeddings)
            processed_chunks = start + len(batch_chunks)
            await progress("embedding", 50 + int((start + len(batch_chunks) / 2) / total_chunks * 40), {
                "chunks": total_chunks,
                "total_chunks": total_chunks,
                "processed_chunks": processed_chunks,
                "embedded_chunks": embedded_chunks,
            })

            actions = []
            for offset, (typed_chunk, embedding) in enumerate(zip(batch_chunks, batch_embeddings)):
                index = start + offset
                chunk = typed_chunk.text
                content_language = detect_language(chunk)
                doc_id = hashlib.md5(f"{file_id}::{index}".encode()).hexdigest()
                doc = {
                    "_index": get_language_index("doc_chunks", content_language),
                    "_id": doc_id,
                    "id": doc_id,
                    "title": f"{filename} [{index + 1}/{total_chunks}]",
                    "content": chunk,
                    "url": f"file://{file_id}::chunk{index}",
                    "source": f"문서({ext.upper().lstrip('.')})",
                    "indexed_at": indexed_at,
                    "created_at": indexed_at,
                    "updated_at": indexed_at,
                    "content_language": content_language,
                    "doc_hash": doc_id,
                    "file_id": file_id,
                    "original_file": filename,
                    "chunk_index": index,
                    "total_chunks": total_chunks,
                    "content_length": len(chunk),
                    "embedding_model": "ggml-org/bge-m3-Q8_0-GGUF",
                    "chunk_type": typed_chunk.chunk_type,
                    "heading_path": typed_chunk.heading_path or [],
                    "page_number": typed_chunk.page_number,
                }
                if embedding:
                    doc["embedding"] = embedding
                actions.append(doc)

            success, _ = await async_bulk(
                es,
                actions,
                refresh=False,
            )
            indexed += success
            await progress("indexing_chunks", 50 + int(processed_chunks / total_chunks * 40), {
                "chunks": total_chunks,
                "total_chunks": total_chunks,
                "embedded_chunks": embedded_chunks,
                "indexed_chunks": indexed,
            })
        await es.indices.refresh(index=DOC_CHUNKS_INDEX)

        await progress("saving_metadata", 90, None)
        await es.index(
            index=FILES_INDEX,
            id=file_id,
            document={
                "file_id": file_id,
                "filename": filename,
                "file_ext": ext.lstrip("."),
                "file_size": tmp.stat().st_size,
                "chunk_count": indexed,
                "indexed_at": indexed_at,
                "original_path": str(dest),
                "content_hash": content_hash,
            },
            refresh=True,
        )
        await es.index(
            index=DOCUMENT_ORIGINALS_INDEX,
            id=file_id,
            document={
                "document_id": file_id,
                "source_type": "document",
                "title": filename,
                "content": original_text,
                "url": f"file://{file_id}",
                "file_ext": ext.lstrip("."),
                "content_length": len(original_text),
                "created_at": indexed_at,
                "updated_at": indexed_at,
            },
            refresh=True,
        )
    finally:
        await es.close()

    result = {
        "file_id": file_id,
        "filename": filename,
        "chunks": indexed,
        "total_chunks": total_chunks,
        "embedded_chunks": embedded_chunks,
        "indexed_chunks": indexed,
        "already_exists": False,
    }
    logger.info("인덱싱 완료: %s → %d청크 (file_id: %s)", filename, indexed, file_id)
    await progress("completed", 100, result)
    return result


@router.post("/document/index")
async def index_document(file: UploadFile = File(...)):
    """파싱 + 청크 인덱싱 + 원본 파일 저장 + rag_files 메타 저장"""
    _validate(file)
    filename = file.filename or "document"
    tmp = await _save_temp(file)
    try:
        return await _index_saved_document(tmp, filename)

    except HTTPException:
        raise
    except Exception as e:
        logger.error("index 실패 [%s]: %s", filename, e)
        raise HTTPException(status_code=500, detail=f"인덱싱 실패: {e}")
    finally:
        tmp.unlink(missing_ok=True)


@router.post("/document/index-progress")
async def index_document_progress(file: UploadFile = File(...)):
    """문서 인덱싱 단계와 결과를 줄 단위 JSON 스트림으로 반환한다."""
    _validate(file)
    filename = file.filename or "document"
    tmp = await _save_temp(file)

    async def event_stream():
        queue: asyncio.Queue[dict] = asyncio.Queue()

        async def report(stage: str, percent: int, details: dict | None = None) -> None:
            await queue.put({
                "type": "progress",
                "stage": stage,
                "percent": percent,
                "filename": filename,
                **(details or {}),
            })

        async def run_indexing() -> None:
            try:
                result = await _index_saved_document(tmp, filename, report)
                await queue.put({"type": "result", **result})
            except HTTPException as exc:
                await queue.put({"type": "error", "message": str(exc.detail)})
            except Exception as exc:
                logger.error("index stream 실패 [%s]: %s", filename, exc)
                await queue.put({"type": "error", "message": f"인덱싱 실패: {exc}"})
            finally:
                tmp.unlink(missing_ok=True)
                await queue.put({"type": "end"})

        task = asyncio.create_task(run_indexing())
        try:
            while True:
                event = await queue.get()
                if event["type"] == "end":
                    break
                yield json.dumps(event, ensure_ascii=False) + "\n"
        finally:
            if not task.done():
                task.cancel()
            await asyncio.gather(task, return_exceptions=True)
            tmp.unlink(missing_ok=True)

    return StreamingResponse(
        event_stream(),
        media_type="application/x-ndjson",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ─────────────────────────────
# GET /api/document/files
# ─────────────────────────────

@router.get("/document/files")
async def list_files():
    """rag_files 인덱스에서 파일 목록 조회"""
    es = get_es()
    try:
        res = await es.search(index=FILES_INDEX, body={
            "size": 200,
            "sort": [{"indexed_at": {"order": "desc"}}],
            "_source": ["file_id", "filename", "file_ext", "file_size", "chunk_count", "indexed_at", "original_path"],
        })
        files = []
        for h in res["hits"]["hits"]:
            s = h["_source"]
            original_path = s.get("original_path")
            has_original = bool(original_path and Path(original_path).exists())
            files.append({
                "file_id": s["file_id"],
                "filename": s["filename"],
                "file_ext": s.get("file_ext", ""),
                "file_size": s.get("file_size", 0),
                "chunk_count": s.get("chunk_count", 0),
                "indexed_at": s.get("indexed_at", ""),
                "has_original": has_original,
            })
        web_res = await es.search(index=WEB_DOCUMENTS_INDEX, body={
                "size": 200,
                "sort": [{"updated_at": {"order": "desc"}}],
                "_source": ["id", "title", "url", "domain", "chunk_count", "updated_at", "saved_at"],
        })
        for hit in web_res["hits"]["hits"]:
            source = hit["_source"]
            files.append({
                    "file_id": hit["_id"], "filename": source.get("title", source.get("url", "")),
                    "file_ext": "web", "file_size": 0, "chunk_count": source.get("chunk_count", 0),
                    "indexed_at": source.get("updated_at", source.get("saved_at", "")), "has_original": False,
                    "source_type": "web", "url": source.get("url", ""), "domain": source.get("domain", ""),
            })
        files.sort(key=lambda item: item.get("indexed_at", ""), reverse=True)
        return {"files": files}
    finally:
        await es.close()


async def _download_documents_as_zip(file_ids: list[str] | None = None) -> StreamingResponse:
    """지정된 원본 문서를 ZIP 파일 하나로 반환한다. None이면 모든 문서를 포함한다."""
    es = get_es()
    try:
        query = {"match_all": {}} if file_ids is None else {"ids": {"values": file_ids}}
        res = await es.search(
            index=FILES_INDEX,
            body={
                "size": MAX_SAVED_FILES,
                "sort": [{"indexed_at": {"order": "desc"}}],
                "query": query,
                "_source": ["filename", "original_path"],
            },
        )
    finally:
        await es.close()

    archive_buffer = io.BytesIO()
    used_names: set[str] = set()
    archived_count = 0
    with zipfile.ZipFile(archive_buffer, mode="w", compression=zipfile.ZIP_DEFLATED) as archive:
        for hit in res["hits"]["hits"]:
            source = hit["_source"]
            original_path = source.get("original_path")
            if not original_path:
                continue
            path = Path(original_path)
            if not path.is_file():
                continue

            filename = Path(source.get("filename") or path.name).name
            stem = Path(filename).stem
            suffix = Path(filename).suffix
            archive_name = filename
            duplicate_index = 2
            while archive_name.casefold() in used_names:
                archive_name = f"{stem} ({duplicate_index}){suffix}"
                duplicate_index += 1
            used_names.add(archive_name.casefold())
            archive.write(path, arcname=archive_name)
            archived_count += 1

    if archived_count == 0:
        raise HTTPException(status_code=404, detail="다운로드할 원본 파일이 없습니다.")

    archive_buffer.seek(0)
    archive_date = datetime.now().strftime("%Y%m%d")
    return StreamingResponse(
        archive_buffer,
        media_type="application/zip",
        headers={
            "Content-Disposition": f'attachment; filename="saved-documents-{archive_date}.zip"',
            "Access-Control-Expose-Headers": "Content-Disposition",
        },
    )


@router.get("/document/files/download-all")
async def download_all_files():
    """보관 중인 원본 문서를 ZIP 파일 하나로 다운로드한다."""
    return await _download_documents_as_zip()


@router.post("/document/files/download")
async def download_selected_files(request: SelectedDocumentsDownloadRequest):
    """선택된 원본 문서를 ZIP 파일 하나로 다운로드한다. 웹 문서는 포함하지 않는다."""
    unique_file_ids = list(dict.fromkeys(request.file_ids))
    return await _download_documents_as_zip(unique_file_ids)


@router.delete("/document/files")
async def delete_all_files():
    """모든 원본 파일과 문서 청크 및 파일 메타데이터를 삭제한다."""
    es = get_es()
    try:
        res = await es.search(
            index=FILES_INDEX,
            body={"size": MAX_SAVED_FILES, "_source": ["original_path"]},
        )
        file_ids = [hit["_id"] for hit in res["hits"]["hits"]]
        deleted_originals = 0
        for hit in res["hits"]["hits"]:
            original_path = hit["_source"].get("original_path")
            if original_path and Path(original_path).is_file():
                Path(original_path).unlink()
                deleted_originals += 1

        chunks_result = await es.delete_by_query(
            index=DOC_CHUNKS_INDEX,
            body={"query": {"match_all": {}}},
            refresh=True,
        )
        files_result = await es.delete_by_query(
            index=FILES_INDEX,
            body={"query": {"match_all": {}}},
            refresh=True,
        )
        collections_updated = await remove_source_references_from_collections(es, "document", file_ids)
        return {
            "files_deleted": files_result.get("deleted", 0),
            "originals_deleted": deleted_originals,
            "chunks_deleted": chunks_result.get("deleted", 0),
            "collections_updated": collections_updated,
        }
    finally:
        await es.close()


# ─────────────────────────────
# GET /api/document/files/{file_id}
# ─────────────────────────────

@router.get("/document/files/{file_id}")
async def download_file(file_id: str):
    """원본 파일 다운로드"""
    es = get_es()
    try:
        try:
            doc = await es.get(index=FILES_INDEX, id=file_id)
        except Exception:
            raise HTTPException(status_code=404, detail="파일 정보를 찾을 수 없습니다.")

        src = doc["_source"]
        original_path = src.get("original_path")
        if not original_path or not Path(original_path).exists():
            raise HTTPException(status_code=404, detail="원본 파일이 삭제되었습니다.")

        return FileResponse(Path(original_path), filename=src["filename"])
    finally:
        await es.close()


# ─────────────────────────────
# DELETE /api/document/files/{file_id}
# ─────────────────────────────

@router.delete("/document/files/{file_id}")
async def delete_file(file_id: str):
    """원본 파일 삭제 + ES 청크 삭제 + rag_files 메타 삭제"""
    es = get_es()
    try:
        # rag_files에서 메타 조회
        try:
            doc = await es.get(index=FILES_INDEX, id=file_id)
        except Exception:
            try:
                web_doc = await es.get(index=WEB_DOCUMENTS_INDEX, id=file_id)
            except Exception:
                raise HTTPException(status_code=404, detail="문서 정보를 찾을 수 없습니다.")
            from services.db import WEB_DOC_CHUNKS_INDEX
            deleted = await es.delete_by_query(index=WEB_DOC_CHUNKS_INDEX, query={"term": {"web_document_id": file_id}}, refresh=True)
            await es.delete(index=WEB_DOCUMENTS_INDEX, id=file_id, refresh=True)
            if bool(await es.exists(index=DOCUMENT_ORIGINALS_INDEX, id=file_id)):
                await es.delete(index=DOCUMENT_ORIGINALS_INDEX, id=file_id, refresh=True)
            collections_updated = await remove_source_references_from_collections(es, "web", [file_id])
            return {"deleted": web_doc["_source"].get("title", file_id), "file_id": file_id, "chunks_deleted": deleted.get("deleted", 0), "collections_updated": collections_updated}

        src = doc["_source"]
        filename = src.get("filename", file_id)

        # 1. 원본 파일 삭제
        original_path = src.get("original_path")
        if original_path and Path(original_path).exists():
            Path(original_path).unlink()
            logger.info("원본 파일 삭제: %s", original_path)

        # 2. ES 청크 삭제 (delete_by_query)
        del_res = await es.delete_by_query(
            index=DOC_CHUNKS_INDEX,
            body={"query": {"term": {"file_id": file_id}}},
            refresh=True,
        )
        deleted_chunks = del_res.get("deleted", 0)
        logger.info("청크 삭제: %s → %d개 (file_id: %s)", filename, deleted_chunks, file_id)

        # 3. rag_files 메타 삭제
        await es.delete(index=FILES_INDEX, id=file_id, refresh=True)
        if bool(await es.exists(index=DOCUMENT_ORIGINALS_INDEX, id=file_id)):
            await es.delete(index=DOCUMENT_ORIGINALS_INDEX, id=file_id, refresh=True)
        collections_updated = await remove_source_references_from_collections(es, "document", [file_id])

        return {
            "deleted": filename,
            "file_id": file_id,
            "chunks_deleted": deleted_chunks,
            "collections_updated": collections_updated,
        }
    finally:
        await es.close()

@router.get("/document/files/{file_id}/chunks")
async def get_file_chunks(file_id: str):
    """파일 또는 웹 문서 ID에 해당하는 청크 목록 조회"""
    es = get_es()
    try:
        source_fields = ["chunk_index", "total_chunks", "content", "chunk_type", "heading_path", "page_number", "content_length"]
        web_res = await es.search(
            index=WEB_DOC_CHUNKS_INDEX,
            body={
                "query": {"term": {"web_document_id": file_id}},
                "sort": [{"chunk_index": {"order": "asc"}}],
                "size": 500,
                "_source": source_fields,
            }
        )
        is_web_document = bool(web_res["hits"]["hits"])
        res = web_res if is_web_document else await es.search(
            index=DOC_CHUNKS_INDEX,
            body={
                "query": {"term": {"file_id": file_id}},
                "sort": [{"chunk_index": {"order": "asc"}}],
                "size": 500,
                "_source": source_fields,
            }
        )
        chunks = [
            {
                "chunk_index": h["_source"].get("chunk_index", i),
                "content": h["_source"].get("content", ""),
                "chunk_type": h["_source"].get("chunk_type", "paragraph"),
                "heading_path": h["_source"].get("heading_path") or [],
                "page_number": h["_source"].get("page_number"),
                "content_length": h["_source"].get("content_length", 0),
            }
            for i, h in enumerate(res["hits"]["hits"])
        ]
        return {"file_id": file_id, "source_type": "web" if is_web_document else "document", "chunks": chunks, "total": len(chunks)}
    finally:
        await es.close()
