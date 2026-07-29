"""
indexer.py – ES 문서 인덱싱 / 검색 / 통계
"""
import hashlib
import os
import httpx
from datetime import datetime, timezone

from elasticsearch import NotFoundError
from elasticsearch.helpers import async_bulk

from services.runtime_settings import get_runtime_settings
from services.db import DOC_CHUNKS_INDEX, EMAIL_THREADS_INDEX, INDEX_NAME, KNOWLEDGE_COLLECTIONS_INDEX, MEMO_INDEX, QUICKNOTE_INDEX, get_es
from logger import get_logger

logger = get_logger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")

# httpx 싱글턴 — 임베딩 호출마다 새 연결 방지
_http_client: httpx.AsyncClient | None = None

def _get_http_client() -> httpx.AsyncClient:
    global _http_client
    if _http_client is None or _http_client.is_closed:
        _http_client = httpx.AsyncClient(
            timeout=httpx.Timeout(180.0, connect=15.0, pool=180.0),
            limits=httpx.Limits(max_connections=20, max_keepalive_connections=10),
        )
    return _http_client


_BGE_QUERY_PREFIX = "Represent this sentence for searching relevant passages: "


class EmbeddingContextExceeded(Exception):
    """bge-m3 컨텍스트 한도를 초과해서 Ollama가 임베딩을 거부했을 때.
    호출부(chat_file_index.py)가 이걸 잡아서 "그때만" 분할 재시도하는 데 쓴다 —
    미리 글자 수로 어림짐작해서 자르지 않고, 실제 API가 거부할 때만 대응한다."""
    pass


async def get_embedding(text: str, is_query: bool = False, raise_on_context_exceeded: bool = False) -> list[float] | None:
    """BGE-M3 임베딩 생성.

    입력 길이를 미리 추정해서 자르지 않는다 — bge-m3의 실제 토큰 한도(모델마다,
    설정마다 다를 수 있음)를 문자 수만으로 정확히 예측할 수 없기 때문에, 그냥
    있는 그대로 보내보고 Ollama가 "컨텍스트 초과"로 거부하면 대응한다.

    raise_on_context_exceeded=True 인 경우에만 EmbeddingContextExceeded를 던진다
    (예: chat_file_index.py가 "그때만 분할 재시도"하려는 경우). 기본값(False)은 기존과
    동일하게 그 경우도 로그만 남기고 None을 반환한다 — get_embedding을 이미 쓰고 있는
    다른 호출부(문서/메모 인덱싱, RAG 검색 등)가 이 새 예외 때문에 갑자기 처리 안 된
    예외로 죽지 않도록 하기 위한 안전한 기본값이다.
    """
    prompt = _BGE_QUERY_PREFIX + text if is_query else text
    settings = get_runtime_settings()

    try:
        client = _get_http_client()
        resp = await client.post(
            f"{OLLAMA_URL}/api/embed",
            json={
                "model": "bge-m3",
                "input": prompt,
                "keep_alive": settings["ollama_keep_alive"],
                "options": {"num_ctx": settings["bge_num_ctx"]},
            },
        )
        if not resp.is_success:
            body_text = resp.text
            if raise_on_context_exceeded and "context length" in body_text.lower():
                # 호출부가 분할 재시도할 수 있게 구분되는 예외로 던진다 (일반 실패와 다르게 처리).
                logger.info("임베딩 컨텍스트 초과 (입력 %d자) — 분할 재시도 필요: %s", len(prompt), body_text[:200])
                raise EmbeddingContextExceeded(body_text)
            logger.warning("임베딩 실패: HTTP %s | body: %s", resp.status_code, body_text)
            return None
        return resp.json()["embeddings"][0]
    except EmbeddingContextExceeded:
        raise
    except Exception as e:
        logger.exception("임베딩 실패: %s", e)
        return None

async def index_documents(docs: list[dict]) -> dict:
    import asyncio as _asyncio
    es = get_es()
    indexed = skipped = 0
    try:
        # mget 일괄 중복 체크 (N번 GET → 1번)
        all_hashes = [hashlib.md5(doc["url"].encode()).hexdigest() for doc in docs]
        mget_res = await es.mget(index=INDEX_NAME, body={"ids": all_hashes})
        existing_ids = {item["_id"] for item in mget_res["docs"] if item.get("found")}
        to_index = []
        for doc, doc_hash in zip(docs, all_hashes):
            if doc_hash in existing_ids:
                skipped += 1
            else:
                to_index.append((doc_hash, doc))

        if not to_index:
            return {"indexed": 0, "skipped": skipped}

        embed_texts = [f"{doc['title']}\n{doc['content']}" for _, doc in to_index]
        embeddings = await _asyncio.gather(*[get_embedding(t) for t in embed_texts])

        actions = []
        for (doc_hash, doc), embedding in zip(to_index, embeddings):
            indexed_at = doc.get("pub_date") or datetime.now().isoformat()
            action = {
                "_index": INDEX_NAME,
                "_id": doc_hash,
                "title": doc["title"],
                "content": doc["content"],
                "url": doc["url"],
                "source": doc["source"],
                "indexed_at": indexed_at,
                "doc_hash": doc_hash,
                "news_type": doc.get("news_type") or None,
                "content_length": len(doc["content"]),
                "embedding_model": "bge-m3",
            }
            if embedding:
                action["embedding"] = embedding
            actions.append(action)

        success, _ = await async_bulk(es, actions, refresh=False)
        await es.indices.refresh(index=INDEX_NAME)
        indexed = success
    finally:
        await es.close()
    return {"indexed": indexed, "skipped": skipped}


def _rerank(hits: list[dict], size: int, preserve_order: bool = False) -> list[dict]:
    """score 기반 정렬, 파일 문서 후순위 (score에 패널티)
    preserve_order=True: RRF처럼 이미 정렬된 경우 순서 유지
    """
    FILE_DOC_PENALTY = 0.8  # 파일 문서 score 감쇠 계수

    results = []
    for h in hits:
        source = h["_source"].get("source", "")
        score = round(h["_score"] or 0, 3)
        is_file_doc = "문서" in source
        adjusted_score = score * FILE_DOC_PENALTY if is_file_doc else score
        result = {
            "title": h["_source"]["title"],
            "content": h["_source"]["content"],
            "url": h["_source"].get("url", f"memo://{h['_source'].get('id', h['_id'])}"),
            "source": source,
            "indexed_at": h["_source"].get("indexed_at", h["_source"].get("updated_at", "")),
            "score": adjusted_score,
            **({"memo_id": h["_source"].get("id", h["_id"])} if source == "memo" else {}),
        }
        results.append(result)

    if not preserve_order:
        results.sort(key=lambda r: r["score"], reverse=True)
    return results[:size]


async def rag_search(query: str, size: int = 5) -> list[dict]:
    """RAG 전용 검색 — BM25 + kNN 별도 실행 후 RRF 직접 계산"""
    query = (query or "").strip()
    if not query:
        return []

    es = get_es()
    BM25_POOL = 20   # BM25 후보 수
    KNN_POOL  = 20   # kNN 후보 수
    RERANK_K  = max(size * 2, 10)  # reranker에 넘길 후보 (최소 10)
    RRF_K = 60        # RRF 표준 상수
    _source = ["title", "content", "url", "source", "indexed_at", "id", "updated_at"]

    bm25_body = {
        "size": BM25_POOL,
        "_source": _source,
        "query": {
            "function_score": {
                "query": {
                    "bool": {
                        "should": [
                            {"match_phrase": {"title": {"query": query, "boost": 5, "slop": 1}}},
                            {"match": {"title": {"query": query, "boost": 3, "minimum_should_match": "60%"}}},
                            {"match": {"content": {"query": query, "minimum_should_match": "60%"}}},
                        ],
                        "minimum_should_match": 1,
                    }
                },
                "functions": [{
                    "gauss": {
                        "indexed_at": {
                            "origin": "now",
                            "scale": "7d",
                            "decay": 0.5,
                            "offset": "1d",
                        }
                    },
                    "weight": 2,
                }],
                "score_mode": "multiply",
                "boost_mode": "multiply",
            }
        },
    }

    try:
        embedding = await get_embedding(query, is_query=True)
        logger.info("[rag_search] query=%r embedding=%s", query, "OK" if embedding else "FAILED")

        if embedding:
            knn_body = {
                "size": KNN_POOL,
                "_source": _source,
                "knn": {
                    "field": "embedding",
                    "query_vector": embedding,
                    "k": KNN_POOL,
                    "num_candidates": KNN_POOL * 5,
                },
            }
            import asyncio as _asyncio
            bm25_res, knn_res = await _asyncio.gather(
                es.search(index=[INDEX_NAME, MEMO_INDEX], body=bm25_body),
                es.search(index=[INDEX_NAME, MEMO_INDEX], body=knn_body),
            )
            bm25_hits = bm25_res["hits"]["hits"]
            knn_hits  = knn_res["hits"]["hits"]
            logger.info("[rag_search] BM25=%d kNN=%d", len(bm25_hits), len(knn_hits))

            # RRF 직접 계산 — rank 기반, scale 무관
            rrf_scores: dict = {}
            for rank, h in enumerate(bm25_hits, start=1):
                doc_key = (h["_index"], h["_id"])
                rrf_scores[doc_key] = rrf_scores.get(doc_key, 0) + 1 / (RRF_K + rank)
            for rank, h in enumerate(knn_hits, start=1):
                doc_key = (h["_index"], h["_id"])
                rrf_scores[doc_key] = rrf_scores.get(doc_key, 0) + 1 / (RRF_K + rank)

            all_hits: dict = {(h["_index"], h["_id"]): h for h in knn_hits}
            all_hits.update({(h["_index"], h["_id"]): h for h in bm25_hits})
            sorted_keys = sorted(rrf_scores, key=lambda key: rrf_scores[key], reverse=True)
            logger.info("[rag_search] RRF top5=%s scores=%s",
                        sorted_keys[:5], [round(rrf_scores[key], 4) for key in sorted_keys[:5]])

            merged_hits = [all_hits[doc_key] for doc_key in sorted_keys if doc_key in all_hits]
            candidates = _rerank(merged_hits, RERANK_K, preserve_order=True)
        else:
            logger.warning("[rag_search] BM25 fallback 진입")
            bm25_res = await es.search(
                index=[INDEX_NAME, MEMO_INDEX],
                body={**bm25_body, "min_score": 1.0},
            )
            candidates = _rerank(bm25_res["hits"]["hits"], RERANK_K)

        from reranker import rerank as _rerank_model, is_available
        if is_available() and candidates:
            return await _rerank_model(query, candidates, top_k=size)
        return candidates[:size]

    except Exception as e:
        logger.error("[rag_search] 예외: %s", e)
        return []
    finally:
        await es.close()


async def knowledge_collection_search(collection_id: str, query: str, size: int = 5) -> tuple[list[dict], str]:
    """컬렉션에 연결된 문서 청크와 메모만 검색한다.

    컬렉션은 원문을 복제하지 않으므로 이 검색은 기존 인덱스의 file_id/id만 필터링한다.
    """
    if not collection_id or not query.strip():
        return [], ""
    es = get_es()
    try:
        collection = await es.get(index=KNOWLEDGE_COLLECTIONS_INDEX, id=collection_id)
        source = collection["_source"]
        items = source.get("items", [])
        document_ids = [item["source_id"] for item in items if item.get("source_type") == "document"]
        memo_ids = [item["source_id"] for item in items if item.get("source_type") == "memo"]
        email_thread_ids = [item["source_id"] for item in items if item.get("source_type") == "email_thread"]
        if not document_ids and not memo_ids and not email_thread_ids:
            return [], str(source.get("instruction", "")).strip()

        embedding = await get_embedding(query, is_query=True)
        searches = []
        if document_ids:
            body = {"size": size, "_source": ["title", "content", "url", "source", "indexed_at", "file_id", "chunk_type", "heading_path", "page_number"],
                    "query": {"bool": {"filter": [{"terms": {"file_id": document_ids}}], "should": [{"match": {"title": {"query": query, "boost": 3}}}, {"match": {"content": {"query": query}}}], "minimum_should_match": 0}}}
            if embedding:
                body["knn"] = {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"file_id": document_ids}}}
            searches.append(es.search(index=DOC_CHUNKS_INDEX, body=body))
        if memo_ids:
            body = {"size": size, "_source": ["id", "title", "content", "source", "updated_at"],
                    "query": {"bool": {"filter": [{"terms": {"id": memo_ids}}], "should": [{"match": {"title": {"query": query, "boost": 3}}}, {"match": {"content": {"query": query}}}], "minimum_should_match": 0}}}
            if embedding:
                body["knn"] = {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"id": memo_ids}}}
            searches.append(es.search(index=MEMO_INDEX, body=body))
        if email_thread_ids:
            body = {"size": size, "_source": ["subject", "rag_content", "indexed_at", "thread_id", "inline_images"],
                    "query": {"bool": {"filter": [{"terms": {"_id": email_thread_ids}}], "should": [{"match": {"subject": {"query": query, "boost": 3}}}, {"match": {"rag_content": {"query": query}}}], "minimum_should_match": 0}}}
            if embedding:
                body["knn"] = {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"_id": email_thread_ids}}}
            searches.append(es.search(index=EMAIL_THREADS_INDEX, body=body))

        import asyncio as _asyncio
        responses = await _asyncio.gather(*searches)
        results = []
        for response in responses:
            for hit in response["hits"]["hits"]:
                item = hit["_source"]
                is_memo = item.get("source") == "memo"
                is_email_thread = "thread_id" in item
                results.append({"title": item.get("title", item.get("subject", "")), "content": item.get("rag_content", ""),
                                "url": f"memo://{item.get('id', hit['_id'])}" if is_memo else (f"email-thread://{hit['_id']}" if is_email_thread else item.get("url", "")),
                                "source": item.get("source", "email_thread" if is_email_thread else "memo" if is_memo else ""),
                                "indexed_at": item.get("updated_at", item.get("indexed_at", "")),
                                "score": round(hit.get("_score") or 0, 3),
                                **({"inline_images": item.get("inline_images", [])} if is_email_thread else {}),
                                **({"memo_id": item.get("id", hit["_id"])} if is_memo else {})})
        results.sort(key=lambda item: item["score"], reverse=True)
        return results[:size], str(source.get("instruction", "")).strip()
    except Exception as error:
        logger.warning("[knowledge_collection_search] failed (%s): %s", collection_id, error)
        return [], ""
    finally:
        await es.close()


async def get_index_stats() -> dict:
    es = get_es()
    try:
        try:
            res = await es.count(index=INDEX_NAME)
            count = res["count"]
        except Exception:
            count = 0
        return {"total_documents": count, "index": INDEX_NAME}
    finally:
        await es.close()


async def memo_search(query: str, size: int = 3) -> list[dict]:
    """일반/빠른 메모 검색 — 각각 1개 문서당 1개 임베딩을 쓰는 하이브리드 검색."""
    if not query or not query.strip():
        return []

    # 긴 쿼리는 노이즈 매칭이 많아짐 — 첫 문장만 사용
    q = query.strip()
    if len(q) > 100:
        for sep in ["\n", ". ", "? ", "! "]:
            idx = q.find(sep)
            if 0 < idx <= 150:
                q = q[:idx]
                break
        else:
            q = q[:100]

    es = get_es()
    try:
        embedding = await get_embedding(q, is_query=True)

        if embedding:
            res = await es.search(
                index=MEMO_INDEX,
                size=size,
                min_score=15,
                _source=["title", "content", "id", "source", "updated_at"],
                knn={
                    "field": "embedding",
                    "query_vector": embedding,
                    "k": size * 4,
                    "num_candidates": size * 20,
                },
                query={
                    "bool": {
                        "should": [
                            {"match_phrase": {"title": {"query": q, "boost": 5}}},
                            {"match": {"title": {"query": q, "boost": 3, "minimum_should_match": "30%"}}},
                            {"match": {"content": {"query": q, "minimum_should_match": "30%"}}},
                        ],
                        "minimum_should_match": 1,
                    }
                },
            )
        else:
            # 임베딩 실패 시 BM25 fallback
            logger.warning("[memo_search] 임베딩 실패, BM25 fallback")
            res = await es.search(
                index=MEMO_INDEX,
                size=size,
                min_score=15,
                _source=["title", "content", "id", "source", "updated_at"],
                query={
                    "bool": {
                        "should": [
                            {"match_phrase": {"title": {"query": q, "boost": 5}}},
                            {"match": {"title": {"query": q, "boost": 3, "minimum_should_match": "30%"}}},
                            {"match": {"content": {"query": q, "minimum_should_match": "30%"}}},
                        ],
                        "minimum_should_match": 1,
                    }
                },
            )

        quicknote_result = await quicknote_search(q, size=size, embedding=embedding)
        hits_info = [(h["_source"].get("title",""), round(h["_score"] or 0, 3)) for h in res["hits"]["hits"]]
        logger.info("[memo_search] query=%r hits=%d scores=%s", q, len(res["hits"]["hits"]), hits_info)
        memo_results = [
            {
                "title": h["_source"]["title"],
                "content": h["_source"]["content"],
                "url": f"memo://{h['_source'].get('id', h['_id'])}",
                "source": "memo",
                "indexed_at": h["_source"].get("updated_at", ""),
                "score": round(h["_score"] or 0, 3),
                "memo_id": h["_source"].get("id", h["_id"]),
            }
            for h in res["hits"]["hits"]
        ]
        return memo_results + quicknote_result
    except Exception as e:
        logger.warning("[memo_search] 실패: %s", e)
        return []
    finally:
        await es.close()


async def quicknote_search(query: str, size: int = 3, embedding: list[float] | None = None) -> list[dict]:
    """빠른 메모를 일반 메모 검색과 같은 임베딩/BM25 방식으로 조회한다."""
    es = get_es()
    try:
        if embedding:
            res = await es.search(
                index=QUICKNOTE_INDEX,
                size=size,
                _source=["id", "text", "done", "updated_at"],
                knn={
                    "field": "embedding", "query_vector": embedding,
                    "k": size * 4, "num_candidates": size * 20,
                },
                query={"match": {"text": {"query": query, "minimum_should_match": "30%"}}},
            )
        else:
            logger.warning("[quicknote_search] 임베딩 실패, BM25 fallback")
            res = await es.search(
                index=QUICKNOTE_INDEX,
                size=size,
                _source=["id", "text", "done", "updated_at"],
                query={"match": {"text": {"query": query, "minimum_should_match": "30%"}}},
            )

        return [
            {
                "title": "빠른 메모" + (" (완료)" if h["_source"].get("done") else ""),
                "content": h["_source"]["text"],
                "url": f"quicknote://{h['_source'].get('id', h['_id'])}",
                "source": "quicknote",
                "indexed_at": h["_source"].get("updated_at", ""),
                "score": round(h.get("_score") or 0, 3),
                "quicknote_id": h["_source"].get("id", h["_id"]),
            }
            for h in res["hits"]["hits"]
        ]
    except Exception as e:
        logger.warning("[quicknote_search] 실패: %s", e)
        return []
    finally:
        await es.close()
