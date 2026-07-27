"""
services/chat_file_index.py – 채팅 첨부(zip/파일) 청크 인덱싱 + 검색

첫 턴에 zip/파일을 통째로 LLM에 넘기는 것과 별개로, 같은 내용을 청크+임베딩으로
`chat_file_chunks`에 저장해둔다. 다음 턴부터는 재첨부 없이도 conv_id 스코프로
임베딩 검색해서 관련된 조각만 다시 프롬프트에 넣을 수 있다 (전체 재전송 없음).

⚠ 청킹 방식 주의: 확장자로 "문서류"와 "코드/설정류"를 나눠서 다르게 처리한다.
- 문서류(PARSERS.keys() 중 .md 제외 — pdf/docx/xlsx/pptx/txt/html 등): 문단 경계가 없어도 나눠
  읽기 쉬우므로 순수 글자 수 기준 슬라이딩 윈도우(CHUNK_SIZE=1500자, CHUNK_OVERLAP=150자)로 청킹한다.
- 코드/설정류(.py/.ts/.json/.yaml 등 나머지 전부) + .md: 함수/블록/문서 전체가 중간에 잘리면 안 되므로
  파일 하나를 통째로 청크 1개로 취급한다(자르지 않음). .md는 "마크다운 수정해줘" 같은 요청에서
  파일 전체를 그대로 돌려줘야 하는 경우가 많아 코드류와 동일하게 취급한다.
services/indexer.py + services/document_parser.py가 담당하는 (PDF 등) 일반 문서 인덱싱은 이것과
별개의 파이프라인으로, chunk_type(table/code/heading/paragraph)과 page_number 등 문단/구조 인식
정보를 채워 넣는 더 정교한 방식이다. 이 모듈은 그 정도의 구조 인식은 하지 않으므로, ES 문서에
chunk_method 필드("sliding_window_char" | "whole_file")를 남겨 두 파이프라인 산출물을 구분한다.

LLM 호출은 전혀 없다 — 임베딩 생성(병렬)과 ES 검색만 사용한다.
"""
import asyncio
import hashlib
import re
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path

from elasticsearch.helpers import async_bulk

from logger import get_logger
from services.db import CHAT_FILE_CHUNKS_INDEX, get_es
from services.document_parser import PARSERS
from services.indexer import get_embedding, EmbeddingContextExceeded

logger = get_logger(__name__)

CHUNK_SIZE = 1500     # 청크 하나당 최대 글자 수 (문서류에만 적용)
CHUNK_OVERLAP = 150   # 청크 경계에서 문맥 끊기지 않도록 겹치는 글자 수 (문서류에만 적용)
SEARCH_SIZE = 15      # 자동조회 시 가져올 청크 개수
MAX_SYMBOLS = 40      # 메타데이터로 뽑아내는 클래스/함수/제목 이름 최대 개수

# 완벽한 파서가 아니라 "임베딩 입력 앞부분에 실어 보낼 이름표" 용도의 가벼운 정규식 추출.
# 언어별로 정확하진 않지만, 클래스/함수/제목 이름 정도는 웬만한 파일에서 뽑아낸다.
_SYMBOL_PATTERNS = [
    re.compile(r'^\s*class\s+([A-Za-z_]\w*)', re.MULTILINE),                       # python/java/kt/php 등
    re.compile(r'^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)', re.MULTILINE),            # python
    re.compile(r'^\s*(?:export\s+)?(?:default\s+)?function\s*\*?\s+([A-Za-z_]\w*)', re.MULTILINE),  # js/ts
    re.compile(r'^\s*func\s+(?:\([^)]*\)\s*)?([A-Za-z_]\w*)', re.MULTILINE),       # go
    re.compile(r'^\s*(?:export\s+)?(?:const|let|var)\s+([A-Za-z_]\w*)\s*=\s*(?:async\s*)?\(', re.MULTILINE),  # js/ts 화살표 함수
    re.compile(r'^\s*(?:public|private|protected)\s+(?:static\s+)?[\w<>\[\],\s]+?\s+([A-Za-z_]\w*)\s*\(', re.MULTILINE),  # java/c#
    re.compile(r'^#{1,6}\s+(.+)$', re.MULTILINE),                                   # markdown 제목
]


def _extract_code_symbols(content: str) -> list[str]:
    """파일 내용에서 클래스/함수/제목 이름을 가볍게 뽑아낸다 (완벽하지 않아도 됨)."""
    names: list[str] = []
    seen: set[str] = set()
    for pattern in _SYMBOL_PATTERNS:
        for m in pattern.finditer(content):
            name = m.group(1).strip()
            if name and name not in seen:
                seen.add(name)
                names.append(name)
            if len(names) >= MAX_SYMBOLS:
                return names
    return names


def _build_embed_header(filename: str, content: str) -> str:
    """임베딩 입력 맨 앞에 붙일 메타데이터 헤더(파일 경로 + 클래스/함수/제목 목록).

    이 헤더를 항상 맨 앞에 둬야, 나중에 파일이 너무 커서 분할 재시도가 발생하더라도
    (get_embedding이 EmbeddingContextExceeded를 던지는 경우) 각 조각에도 "이 청크가
    어떤 파일 소속인지"가 항상 반영된다. 검색 품질(파일명/함수명으로도 매칭)에도 도움이 된다.
    """
    symbols = _extract_code_symbols(content)
    header = f"파일: {filename}"
    if symbols:
        header += f"\n포함된 클래스/함수/제목: {', '.join(symbols)}"
    return header

# 문단 단위로 나눠도 의미가 보존되는 "문서류" 확장자만 슬라이딩 윈도우로 청킹한다.
# (PARSERS는 document_parser.py가 파싱 가능한 문서 포맷 — pdf/docx/xlsx/pptx/txt/html/md)
# 그 외(.py/.ts/.tsx/.json/.yaml/... 코드·설정 파일)는 함수/블록이 중간에 잘리면 안 되므로
# 파일 하나 = 청크 하나로 통째로 넣는다.
# .md는 PARSERS엔 있지만 여기서는 제외 — 마크다운 수정 요청처럼 파일 전체를 그대로 돌려줘야
# 하는 경우가 많아서(문단이 잘리면 안 됨) whole_file 쪽으로 둔다.
_DOC_EXTS = set(PARSERS.keys()) - {".md"}


def _split_into_chunks(content: str) -> list[str]:
    """단순 슬라이딩 윈도우 청크 분할 (문서류 전용, 문법 인식 없음)."""
    if len(content) <= CHUNK_SIZE:
        return [content]
    chunks = []
    start = 0
    while start < len(content):
        end = start + CHUNK_SIZE
        chunks.append(content[start:end])
        if end >= len(content):
            break
        start = end - CHUNK_OVERLAP
    return chunks


async def index_chat_files_progress(
        conv_id: str, source_name: str, file_docs: list[dict], batch_id: str | None = None,
):
    """
    index_chat_files()와 동일한 작업을 하되, 파일 하나 처리할 때마다
    {"type": "progress", "done": i, "total": N, "filename": ...} 를 yield하는 버전.
    마지막에 {"type": "result", "batch_id": ...} 를 yield하고 끝난다.

    호출부(routers/chat.py)가 이 진행 상황을 SSE로 그대로 클라이언트에 흘려서
    "인덱싱 중 (12/245)" 같은 진행 표시를 할 수 있게 하기 위함.
    """
    batch_id = batch_id or str(uuid.uuid4())
    indexed_at = datetime.now(timezone.utc).isoformat()
    _t0 = time.monotonic()

    actions = []
    _method_counts: dict[str, int] = {"whole_file": 0, "sliding_window_char": 0}
    total = len(file_docs)
    for idx, file_doc in enumerate(file_docs, 1):
        filename = file_doc.get("filename") or file_doc.get("original_name", "")
        content = file_doc.get("content", "")
        if not content.strip():
            yield {"type": "progress", "done": idx, "total": total, "filename": filename}
            continue
        file_id = str(uuid.uuid4())

        ext = Path(filename).suffix.lower()
        # 파일 경로 + 클래스/함수/제목 이름을 맨 앞에 붙여서, 나중에 분할이 일어나도
        # 각 조각에 "이 청크가 어떤 파일 소속인지"가 항상 반영되게 한다.
        header = _build_embed_header(filename, content)

        if ext in _DOC_EXTS:
            # 문서류: 원래부터 문단 경계 없이 나눠도 되는 포맷이라 처음부터 슬라이딩 윈도우.
            chunks = _split_into_chunks(content)
            chunk_method = "sliding_window_char"
            embed_texts = [f"{header}\n\n{c}" for c in chunks]
            try:
                embeddings = await asyncio.gather(*[get_embedding(t) for t in embed_texts])
            except Exception as e:
                logger.warning("[chat_file_index] 임베딩 생성 실패 [%s]: %s", filename, e)
                yield {"type": "progress", "done": idx, "total": total, "filename": filename}
                continue
        else:
            # 코드/설정/md: 웬만하면 파일 하나 = 청크 하나로 통째로 넣는다(함수/블록이
            # 중간에 잘리면 의미가 깨지므로). 글자 수로 미리 추정해서 자르지 않고,
            # 일단 통째로 시도해보고 — 정말 bge-m3 컨텍스트를 초과해서 Ollama가
            # 거부하는 경우에만(EmbeddingContextExceeded) 그때 슬라이딩 윈도우로 분할 재시도.
            whole_text = f"{header}\n\n{content}"
            try:
                embedding = await get_embedding(whole_text, raise_on_context_exceeded=True)
                chunks = [content]
                embeddings = [embedding]
                chunk_method = "whole_file"
            except EmbeddingContextExceeded:
                logger.info("[chat_file_index] %s 파일이 너무 커서 분할 재시도", filename)
                chunks = _split_into_chunks(content)
                embed_texts = [f"{header}\n\n{c}" for c in chunks]
                try:
                    embeddings = await asyncio.gather(*[get_embedding(t) for t in embed_texts])
                except Exception as e:
                    logger.warning("[chat_file_index] 분할 재시도 후에도 임베딩 실패 [%s]: %s", filename, e)
                    yield {"type": "progress", "done": idx, "total": total, "filename": filename}
                    continue
                # whole_file과 구분되는 값으로 남겨서, 어떤 파일이 너무 커서 어쩔 수 없이
                # 분할됐는지 나중에 ES에서 바로 조회할 수 있게 한다.
                chunk_method = "whole_file_split_on_overflow"
            except Exception as e:
                logger.warning("[chat_file_index] 임베딩 생성 실패 [%s]: %s", filename, e)
                yield {"type": "progress", "done": idx, "total": total, "filename": filename}
                continue
        _method_counts[chunk_method] = _method_counts.get(chunk_method, 0) + 1

        for i, (chunk, embedding) in enumerate(zip(chunks, embeddings)):
            doc_id = hashlib.md5(f"{batch_id}::{file_id}::{i}".encode()).hexdigest()
            doc = {
                "_index": CHAT_FILE_CHUNKS_INDEX,
                "_id": doc_id,
                "conv_id": conv_id,
                "batch_id": batch_id,
                "file_id": file_id,
                "filename": filename,
                "source_name": source_name,
                "content": chunk,
                "chunk_index": i,
                "total_chunks": len(chunks),
                "content_length": len(chunk),
                "embedding_model": "bge-m3",
                # 코드/설정 파일은 "whole_file"(통째로 1개 청크), 문서류(PDF/docx/txt/md 등)는
                # "sliding_window_char"(1500자 단위 슬라이딩 윈도우) — services/indexer.py 쪽 문서
                # 인덱싱의 구조 인식 청킹(chunk_type/page_number)과는 또 다른 이 파이프라인 고유 필드.
                "chunk_method": chunk_method,
                "indexed_at": indexed_at,
            }
            if embedding:
                doc["embedding"] = embedding
            actions.append(doc)

        yield {"type": "progress", "done": idx, "total": total, "filename": filename}

    if not actions:
        yield {"type": "result", "batch_id": batch_id}
        return

    es = get_es()
    try:
        success, errors = await async_bulk(es, actions, refresh=False)
        await es.indices.refresh(index=CHAT_FILE_CHUNKS_INDEX)
        elapsed = time.monotonic() - _t0
        logger.info(
            "[chat_file_index] conv_id=%s source=%s → %d개 청크 인덱싱 완료 "
            "(whole_file %d개, 너무 커서 분할 %d개, sliding_window %d개, %.1f초 소요)",
            conv_id, source_name, success,
            _method_counts["whole_file"], _method_counts.get("whole_file_split_on_overflow", 0),
            _method_counts["sliding_window_char"], elapsed,
        )
    except Exception as e:
        logger.warning(
            "[chat_file_index] bulk 인덱싱 실패 (conv_id=%s, source=%s, %.1f초 경과): %s",
            conv_id, source_name, time.monotonic() - _t0, e,
                                  )
    finally:
        await es.close()

    yield {"type": "result", "batch_id": batch_id}


async def index_chat_files(conv_id: str, source_name: str, file_docs: list[dict], batch_id: str | None = None) -> str:
    """
    파일 목록(zip 내부 파일들 또는 개별 첨부 파일들)을 청크+임베딩으로 인덱싱.

    file_docs: [{filename, content, size}, ...] (routers/files.py의 zip/file 업로드 응답 형식)
    batch_id: 호출부(routers/chat.py)에서 미리 생성해서 넘기면 그 값을 그대로 사용
              (project_summary를 이 배치에 매칭시키기 위해 응답 완료 전에 batch_id가 필요하므로).
              안 넘기면 여기서 새로 생성.
    반환값: batch_id (이 첨부 이벤트를 식별하는 ID — attachment_summaries 등에서 참조용)

    진행 상황(progress) 없이 끝까지 다 처리하고 결과만 받고 싶을 때 쓰는 래퍼.
    실시간 진행 표시가 필요하면 index_chat_files_progress()를 직접 쓸 것
    (routers/chat.py의 스트리밍 경로가 이걸 사용한다).
    """
    result_batch_id = batch_id or str(uuid.uuid4())
    async for ev in index_chat_files_progress(conv_id, source_name, file_docs, batch_id=result_batch_id):
        if ev["type"] == "result":
            result_batch_id = ev["batch_id"]
    return result_batch_id


# BM25 키워드 검색 사용 — kNN/임계값 불필요
# 키워드 없는 무관 질문은 BM25 점수 0으로 자연히 걸러짐


async def search_chat_files(conv_id: str, query: str, size: int = SEARCH_SIZE) -> list[dict]:
    """
    이 대화방(conv_id)에 첨부된 파일 청크 중 질문과 관련된 것만 BM25 키워드 검색.
    반환값은 context_docs 형식({title, content, source, url, indexed_at})으로 맞춰서
    다른 RAG 결과와 동일하게 다룰 수 있게 한다.

    kNN(임베딩)이 아닌 BM25를 쓰는 이유: 코드 파일은 자연어가 아니라 kNN 유사도가
    무관한 질문에서도 0.73+ 로 높게 나와 false positive가 많다. BM25는 키워드가
    없으면 점수가 0이라 "주유소 기름값" 같은 무관 질문에선 아무것도 안 잡힌다.
    """
    es = get_es()
    try:
        search_body: dict = {
            "size": size,
            "query": {
                "bool": {
                    "must": {"multi_match": {
                        "query": query,
                        "fields": ["filename^2", "content"],
                        "type": "best_fields",
                    }},
                    "filter": {"term": {"conv_id": conv_id}},
                }
            },
            "_source": ["filename", "content", "source_name", "indexed_at", "chunk_index", "total_chunks"],
        }
        res = await es.search(index=CHAT_FILE_CHUNKS_INDEX, body=search_body)
        hits = res["hits"]["hits"]

        if not hits:
            logger.info("[chat_file_search] conv_id=%s query=%r hits=0", conv_id, query)
            return []
        top = [
            (h["_source"].get("filename", ""), round(h.get("_score") or 0, 4))
            for h in hits[:5]
        ]
        logger.info(
            "[chat_file_search] conv_id=%s query=%r hits=%d top5=%s",
            conv_id, query, len(hits), top,
        )
        docs = [
            {
                "title": f"{h['_source']['filename']} [{h['_source'].get('chunk_index', 0) + 1}/{h['_source'].get('total_chunks', 1)}]",
                "content": h["_source"]["content"],
                "source": f"첨부:{h['_source'].get('source_name', '')}",
                "url": "",
                "score": round(h.get("_score") or 0, 3),
                "indexed_at": h["_source"].get("indexed_at", ""),
            }
            for h in hits
        ]

        return docs
    except Exception as e:
        logger.warning("[chat_file_index] 검색 실패 (conv_id=%s): %s", conv_id, e)
        return []
    finally:
        await es.close()


async def has_chat_files(conv_id: str) -> bool:
    """이 대화방에 인덱싱된 첨부파일 청크가 하나라도 있는지 빠르게 확인 (검색 스킵 여부 판단용)."""
    es = get_es()
    try:
        res = await es.count(index=CHAT_FILE_CHUNKS_INDEX, body={"query": {"term": {"conv_id": conv_id}}})
        return res.get("count", 0) > 0
    except Exception:
        return False
    finally:
        await es.close()


async def delete_chat_files_for_conv(conv_id: str) -> int:
    """방 삭제 시 호출 — 이 대화방에 딸린 첨부파일 청크를 전부 삭제."""
    es = get_es()
    try:
        res = await es.delete_by_query(
            index=CHAT_FILE_CHUNKS_INDEX,
            body={"query": {"term": {"conv_id": conv_id}}},
            refresh=True,
        )
        deleted = res.get("deleted", 0)
        if deleted:
            logger.info("[chat_file_index] conv_id=%s 첨부파일 청크 %d개 삭제", conv_id, deleted)
        return deleted
    except Exception as e:
        logger.warning("[chat_file_index] 삭제 실패 (conv_id=%s): %s", conv_id, e)
        return 0
    finally:
        await es.close()