"""
indexer.py – ES 문서 인덱싱 / 검색 / 통계
"""
import hashlib
import time
from datetime import datetime, timezone

from elasticsearch import NotFoundError
from elasticsearch.helpers import async_bulk

from config.embeddings import EMBEDDING_MODEL_ID
from services.embedding_runtime import EmbeddingContextExceeded, get_embedding, get_embeddings
from services.db import DOC_CHUNKS_INDEX, EMAIL_THREADS_INDEX, INDEX_NAME, KNOWLEDGE_COLLECTIONS_INDEX, MEMO_INDEX, QUICKNOTE_INDEX, WEB_DOC_CHUNKS_INDEX, get_es, get_language_index
from services.language_detection import detect_language
from logger import get_logger

logger = get_logger(__name__)


async def index_documents(docs: list[dict]) -> dict:
    es = get_es()
    indexed = skipped = 0
    try:
        # mget 일괄 중복 체크 (N번 GET → 1번)
        all_hashes = [hashlib.md5(doc["url"].encode()).hexdigest() for doc in docs]
        existing_res = await es.search(index=INDEX_NAME, size=len(all_hashes), query={"ids": {"values": all_hashes}}, _source=False)
        existing_ids = {item["_id"] for item in existing_res["hits"]["hits"]}
        to_index = []
        for doc, doc_hash in zip(docs, all_hashes):
            if doc_hash in existing_ids:
                skipped += 1
            else:
                to_index.append((doc_hash, doc))

        if not to_index:
            return {"indexed": 0, "skipped": skipped}

        embed_texts = [f"{doc['title']}\n{doc['content']}" for _, doc in to_index]
        embeddings = await get_embeddings(embed_texts)

        actions = []
        for (doc_hash, doc), embedding in zip(to_index, embeddings):
            indexed_at = doc.get("pub_date") or datetime.now().isoformat()
            language = detect_language(f"{doc['title']}\n{doc['content']}")
            action = {
                "_index": get_language_index("rag_documents", language),
                "_id": doc_hash,
                "id": doc_hash,
                "title": doc["title"],
                "content": doc["content"],
                "url": doc["url"],
                "source": doc["source"],
                "indexed_at": indexed_at,
                "created_at": indexed_at,
                "updated_at": indexed_at,
                "content_language": language,
                "doc_hash": doc_hash,
                "news_type": doc.get("news_type") or None,
                "content_length": len(doc["content"]),
                "embedding_model": EMBEDDING_MODEL_ID,
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
            "chunk_index": h["_source"].get("chunk_index"),
            "web_document_id": h["_source"].get("web_document_id"),
            "file_id": h["_source"].get("file_id"),
            "heading_path": h["_source"].get("heading_path") or [],
            "page_number": h["_source"].get("page_number"),
            "chunk_type": h["_source"].get("chunk_type"),
            "total_chunks": h["_source"].get("total_chunks"),
            **({"memo_id": h["_source"].get("id", h["_id"])} if source == "memo" else {}),
        }
        results.append(result)

    if not preserve_order:
        results.sort(key=lambda r: r["score"], reverse=True)
    return results[:size]


def _rrf_hits(bm25_hits: list[dict], knn_hits: list[dict], size: int, rrf_k: int = 60) -> list[dict]:
    """Merge independently searched lexical and vector candidates without score-scale bias."""
    scores: dict[tuple[str, str], float] = {}
    hits_by_key: dict[tuple[str, str], dict] = {}
    for hits in (bm25_hits, knn_hits):
        for rank, hit in enumerate(hits, start=1):
            key = (hit["_index"], hit["_id"])
            scores[key] = scores.get(key, 0.0) + 1 / (rrf_k + rank)
            hits_by_key[key] = hit
    return [hits_by_key[key] for key in sorted(scores, key=scores.get, reverse=True)[:size]]


def _retrieval_origins(selected_hits: list[dict], bm25_hits: list[dict], knn_hits: list[dict]) -> list[tuple[str, str]]:
    """Return diagnostic-only origin labels without changing search result payloads."""
    bm25_keys = {(hit["_index"], hit["_id"]) for hit in bm25_hits}
    knn_keys = {(hit["_index"], hit["_id"]) for hit in knn_hits}
    origins: list[tuple[str, str]] = []
    for hit in selected_hits:
        key = (hit["_index"], hit["_id"])
        origin = "hybrid" if key in bm25_keys and key in knn_keys else "bm25" if key in bm25_keys else "vector"
        title = hit.get("_source", {}).get("title") or hit.get("_source", {}).get("content", "")[:40]
        origins.append((title, origin))
    return origins


def _memo_bm25_query(query: str) -> dict:
    return {"bool": {"should": [
        {"match_phrase": {"title": {"query": query, "boost": 5}}},
        {"match": {"title": {"query": query, "boost": 3, "minimum_should_match": "30%"}}},
        {"match": {"content": {"query": query, "minimum_should_match": "30%"}}},
    ], "minimum_should_match": 1}}


def _language_search_indices(index_family: str, language: str) -> str | list[str]:
    """감지 언어 검색에 언어 불명 고유명사·약어 인덱스를 함께 포함한다."""
    language_index = get_language_index(index_family, language)
    unknown_index = get_language_index(index_family, "und")
    return language_index if language == "und" else [language_index, unknown_index]


def _filtered_lexical_query(filter_field: str, identifiers: list[str], query: str) -> dict:
    """컬렉션 범위 안에서도 실제 lexical 근거가 있는 항목만 반환한다."""
    return {
        "bool": {
            "filter": [{"terms": {filter_field: identifiers}}],
            "should": [
                {"match": {"title": {"query": query, "boost": 3}}},
                {"match": {"content": {"query": query}}},
            ],
            "minimum_should_match": 1,
        }
    }


async def rag_search(query: str, size: int = 5) -> list[dict]:
    """일반 RAG 문서 후보 검색 — BM25 + kNN 결과를 RRF로 합친다.

    메모와 빠른메모 후보는 memo_search에서 별도로 모은 뒤, agent의 단일
    reranker 단계에서 일반 RAG 후보와 함께 평가한다.
    """
    query = (query or "").strip()
    if not query:
        return []

    es = get_es()
    query_language = detect_language(query)
    bm25_indices = _language_search_indices("rag_documents", query_language)
    BM25_POOL = 20   # BM25 후보 수
    KNN_POOL  = 20   # kNN 후보 수
    RRF_K = 60        # RRF 표준 상수
    _source = ["title", "content", "url", "source", "indexed_at", "id", "updated_at"]

    bm25_body = {
        "size": BM25_POOL,
        "_source": _source,
        "query": {"bool": {
            "should": [
                {"match_phrase": {"title": {"query": query, "boost": 5, "slop": 1}}},
                {"match": {"title": {"query": query, "boost": 3, "minimum_should_match": "60%"}}},
                {"match": {"content": {"query": query, "minimum_should_match": "60%"}}},
            ],
            "minimum_should_match": 1,
        }},
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
                es.search(index=bm25_indices, body=bm25_body),
                es.search(index=[INDEX_NAME], body=knn_body),
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
            candidates = _rerank(merged_hits, size, preserve_order=True)
        else:
            logger.warning("[rag_search] BM25 fallback 진입")
            bm25_res = await es.search(
                index=bm25_indices,
                body={**bm25_body, "min_score": 1.0},
            )
            candidates = _rerank(bm25_res["hits"]["hits"], size)

        return candidates[:size]

    except Exception as e:
        logger.error("[rag_search] 예외: %s", e)
        return []
    finally:
        await es.close()


def _context_search_query(query: str) -> str:
    """메모 검색의 기존 긴 질문 축약 규칙을 공유한다."""
    normalized_query = query.strip()
    if len(normalized_query) <= 100:
        return normalized_query
    for separator in ["\n", ". ", "? ", "! "]:
        index = normalized_query.find(separator)
        if 0 < index <= 150:
            return normalized_query[:index]
    return normalized_query[:100]


def _msearch_hits(response: dict, response_index: int, source_name: str) -> list[dict]:
    """_msearch의 부분 실패를 다른 출처 검색과 분리해 처리한다."""
    responses = response.get("responses", [])
    if response_index >= len(responses):
        logger.warning("[related_context_search] %s 응답 누락", source_name)
        return []
    result = responses[response_index]
    if result.get("error"):
        logger.warning("[related_context_search] %s 검색 실패: %s", source_name, result["error"])
        return []
    return result.get("hits", {}).get("hits", [])


async def search_related_context_candidates(
        query: str,
        rag_size: int = 10,
        memo_size: int = 10,
) -> list[dict]:
    """일반 RAG·메모·빠른메모 후보를 임베딩 1회와 ES _msearch 1회로 조회한다.

    각 출처의 BM25·kNN 검색식은 기존과 동일하게 유지한다. 검색 결과의 병합과
    최종 관련도 판단은 호출부의 단일 reranker 단계에서 수행한다.
    """
    if not query or not query.strip():
        return []

    rag_query = query.strip()
    memo_query = _context_search_query(query)
    rag_language = detect_language(rag_query)
    memo_language = detect_language(memo_query)
    rag_bm25_pool = 20
    rag_knn_pool = 20
    memo_pool = memo_size * 4
    rag_source_fields = ["title", "content", "url", "source", "indexed_at", "id", "updated_at", "web_document_id", "file_id", "chunk_index", "total_chunks", "chunk_type", "heading_path", "page_number"]
    memo_source_fields = ["title", "content", "id", "source", "updated_at"]
    quicknote_source_fields = ["id", "title", "content", "done", "updated_at"]

    rag_bm25_body = {
        "size": rag_bm25_pool,
        "_source": rag_source_fields,
        "query": {"bool": {
            "should": [
                {"match_phrase": {"title": {"query": rag_query, "boost": 5, "slop": 1}}},
                {"match": {"title": {"query": rag_query, "boost": 3, "minimum_should_match": "60%"}}},
                {"match": {"content": {"query": rag_query, "minimum_should_match": "60%"}}},
            ],
            "minimum_should_match": 1,
        }},
    }
    memo_bm25_body = {"size": memo_pool, "_source": memo_source_fields, "query": _memo_bm25_query(memo_query)}
    quicknote_bm25_body = {
        "size": memo_pool,
        "_source": quicknote_source_fields,
        "query": {"match": {"content": {"query": memo_query, "minimum_should_match": "30%"}}},
    }

    es = get_es()
    try:
        embedding_started_at = time.perf_counter()
        embedding = await get_embedding(rag_query, is_query=True)
        embedding_ms = (time.perf_counter() - embedding_started_at) * 1000
        rag_bm25_search_body = rag_bm25_body if embedding else {**rag_bm25_body, "min_score": 1.0}
        searches: list[dict] = [
            {"index": _language_search_indices("rag_documents", rag_language)}, rag_bm25_search_body,
            {"index": _language_search_indices("web_doc_chunks", rag_language)}, rag_bm25_search_body,
            {"index": _language_search_indices("doc_chunks", rag_language)}, rag_bm25_search_body,
            {"index": _language_search_indices("memo_documents", memo_language)}, memo_bm25_body,
            {"index": _language_search_indices("quick_notes", memo_language)}, quicknote_bm25_body,
        ]
        response_positions = {"rag_bm25": 0, "web_bm25": 1, "doc_bm25": 2, "memo_bm25": 3, "quicknote_bm25": 4}
        if embedding:
            rag_knn_body = {
                "size": rag_knn_pool,
                "_source": rag_source_fields,
                "knn": {"field": "embedding", "query_vector": embedding, "k": rag_knn_pool, "num_candidates": rag_knn_pool * 5},
            }
            memo_knn_body = {
                "size": memo_pool,
                "_source": memo_source_fields,
                "knn": {"field": "embedding", "query_vector": embedding, "k": memo_pool, "num_candidates": memo_size * 20},
            }
            quicknote_knn_body = {
                "size": memo_pool,
                "_source": quicknote_source_fields,
                "knn": {"field": "embedding", "query_vector": embedding, "k": memo_pool, "num_candidates": memo_size * 20},
            }
            searches.extend([
                {"index": INDEX_NAME}, rag_knn_body,
                {"index": WEB_DOC_CHUNKS_INDEX}, rag_knn_body,
                {"index": DOC_CHUNKS_INDEX}, rag_knn_body,
                {"index": MEMO_INDEX}, memo_knn_body,
                {"index": QUICKNOTE_INDEX}, quicknote_knn_body,
            ])
            response_positions.update({"rag_knn": 5, "web_knn": 6, "doc_knn": 7, "memo_knn": 8, "quicknote_knn": 9})
        else:
            logger.warning("[related_context_search] 임베딩 실패, BM25 fallback")

        msearch_started_at = time.perf_counter()
        response = await es.msearch(searches=searches)
        msearch_ms = (time.perf_counter() - msearch_started_at) * 1000
        logger.info(
            "[rag_timing] embedding_ms=%.1f es_msearch_ms=%.1f search_count=%d",
            embedding_ms, msearch_ms, len(searches) // 2,
        )

        rag_bm25_hits = _msearch_hits(response, response_positions["rag_bm25"], "일반 RAG BM25")
        web_bm25_hits = _msearch_hits(response, response_positions["web_bm25"], "웹 문서 BM25")
        doc_bm25_hits = _msearch_hits(response, response_positions["doc_bm25"], "저장 문서 BM25")
        memo_bm25_hits = _msearch_hits(response, response_positions["memo_bm25"], "메모 BM25")
        quicknote_bm25_hits = _msearch_hits(response, response_positions["quicknote_bm25"], "빠른메모 BM25")
        if embedding:
            rag_knn_hits = _msearch_hits(response, response_positions["rag_knn"], "일반 RAG kNN")
            web_knn_hits = _msearch_hits(response, response_positions["web_knn"], "웹 문서 kNN")
            doc_knn_hits = _msearch_hits(response, response_positions["doc_knn"], "저장 문서 kNN")
            memo_knn_hits = _msearch_hits(response, response_positions["memo_knn"], "메모 kNN")
            quicknote_knn_hits = _msearch_hits(response, response_positions["quicknote_knn"], "빠른메모 kNN")
            rag_candidate_hits = _rrf_hits(
                rag_bm25_hits + web_bm25_hits + doc_bm25_hits,
                rag_knn_hits + web_knn_hits + doc_knn_hits,
                rag_size * 2,
            )
            rag_hits = _rerank(
                rag_candidate_hits,
                rag_size * 2,
                preserve_order=True,
            )
            memo_hits = _rrf_hits(
                memo_bm25_hits,
                memo_knn_hits,
                memo_size * 2,
            )
            quicknote_hits = _rrf_hits(
                quicknote_bm25_hits,
                quicknote_knn_hits,
                memo_size,
            )
        else:
            rag_knn_hits = web_knn_hits = doc_knn_hits = memo_knn_hits = quicknote_knn_hits = []
            rag_candidate_hits = rag_bm25_hits + web_bm25_hits + doc_bm25_hits
            rag_hits = _rerank(rag_candidate_hits, rag_size * 2)
            memo_hits = memo_bm25_hits
            quicknote_hits = quicknote_bm25_hits[:memo_size]

        rag_results = rag_hits
        memo_results = [
            {
                "title": hit["_source"]["title"],
                "content": hit["_source"]["content"],
                "url": f"memo://{hit['_source'].get('id', hit['_id'])}",
                "source": "memo",
                "indexed_at": hit["_source"].get("updated_at", ""),
                "score": round(hit.get("_score") or 0, 3),
                "memo_id": hit["_source"].get("id", hit["_id"]),
            }
            for hit in memo_hits[:memo_size]
        ]
        quicknote_results = [
            {
                "title": "빠른 메모" + (" (완료)" if hit["_source"].get("done") else ""),
                "content": hit["_source"]["content"],
                "url": f"quicknote://{hit['_source'].get('id', hit['_id'])}",
                "source": "quicknote",
                "indexed_at": hit["_source"].get("updated_at", ""),
                "score": round(hit.get("_score") or 0, 3),
                "quicknote_id": hit["_source"].get("id", hit["_id"]),
            }
            for hit in quicknote_hits[:memo_size]
        ]
        logger.debug("[related_context_search.query] query=%r", rag_query)
        logger.debug(
            "[related_context_search.results] candidates: rag=%d memo=%d quicknote=%d",
            len(rag_results),
            len(memo_results),
            len(quicknote_results),
        )
        logger.debug(
            "[related_context_search.origins] rag=%s web=%s doc=%s memo=%s quicknote=%s",
            _retrieval_origins(rag_candidate_hits, rag_bm25_hits, rag_knn_hits),
            _retrieval_origins(rag_candidate_hits, web_bm25_hits, web_knn_hits),
            _retrieval_origins(rag_candidate_hits, doc_bm25_hits, doc_knn_hits),
            _retrieval_origins(memo_hits, memo_bm25_hits, memo_knn_hits),
            _retrieval_origins(quicknote_hits, quicknote_bm25_hits, quicknote_knn_hits),
        )
        return rag_results + memo_results + quicknote_results
    except Exception as error:
        logger.warning("[related_context_search] 실패: %s", error)
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
        web_document_ids = [item["source_id"] for item in items if item.get("source_type") == "web"]
        if not document_ids and not memo_ids and not email_thread_ids and not web_document_ids:
            return [], str(source.get("instruction", "")).strip()

        embedding = await get_embedding(query, is_query=True)
        query_language = detect_language(query)
        searches = []
        if document_ids:
            body = {"size": size, "_source": ["title", "content", "url", "source", "indexed_at", "file_id", "chunk_index", "total_chunks", "chunk_type", "heading_path", "page_number"],
                    "query": _filtered_lexical_query("file_id", document_ids, query)}
            searches.append(es.search(index=_language_search_indices("doc_chunks", query_language), body=body))
            if embedding:
                searches.append(es.search(index=DOC_CHUNKS_INDEX, body={"size": size, "_source": body["_source"], "knn": {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"file_id": document_ids}}}}))
        if memo_ids:
            body = {"size": size, "_source": ["id", "title", "content", "source", "updated_at"],
                    "query": _filtered_lexical_query("id", memo_ids, query)}
            searches.append(es.search(index=_language_search_indices("memo_documents", query_language), body=body))
            if embedding:
                searches.append(es.search(index=MEMO_INDEX, body={"size": size, "_source": body["_source"], "knn": {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"id": memo_ids}}}}))
        if web_document_ids:
            body = {"size": size, "_source": ["title", "content", "url", "source", "indexed_at", "web_document_id", "chunk_index", "total_chunks"],
                    "query": _filtered_lexical_query("web_document_id", web_document_ids, query)}
            searches.append(es.search(index=_language_search_indices("web_doc_chunks", query_language), body=body))
            if embedding:
                searches.append(es.search(index=WEB_DOC_CHUNKS_INDEX, body={"size": size, "_source": body["_source"], "knn": {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"web_document_id": web_document_ids}}}}))
        if email_thread_ids:
            body = {"size": size, "_source": ["title", "content", "indexed_at", "thread_id", "inline_images"],
                    "query": _filtered_lexical_query("_id", email_thread_ids, query)}
            searches.append(es.search(index=_language_search_indices("knowledge_email_threads", query_language), body=body))
            if embedding:
                searches.append(es.search(index=EMAIL_THREADS_INDEX, body={"size": size, "_source": body["_source"], "knn": {"field": "embedding", "query_vector": embedding, "k": size, "num_candidates": max(size * 10, 50), "filter": {"terms": {"_id": email_thread_ids}}}}))

        import asyncio as _asyncio
        responses = await _asyncio.gather(*searches)
        merged_hits = _rrf_hits(
            [hit for response in responses[::2] for hit in response["hits"]["hits"]] if embedding else [hit for response in responses for hit in response["hits"]["hits"]],
            [hit for response in responses[1::2] for hit in response["hits"]["hits"]] if embedding else [],
            size * 3,
        )
        results = []
        for hit in merged_hits:
            item = hit["_source"]
            is_memo = item.get("source") == "memo"
            is_email_thread = "thread_id" in item
            content = item.get("content", "")
            results.append({"title": item.get("title", ""), "content": content,
                            "url": f"memo://{item.get('id', hit['_id'])}" if is_memo else (f"email-thread://{hit['_id']}" if is_email_thread else item.get("url", "")),
                            "source": item.get("source", "email_thread" if is_email_thread else "memo" if is_memo else ""),
                            "indexed_at": item.get("updated_at", item.get("indexed_at", "")),
                            "score": round(hit.get("_score") or 0, 3),
                            "chunk_index": item.get("chunk_index"),
                            "web_document_id": item.get("web_document_id"),
                            "file_id": item.get("file_id"),
                            "heading_path": item.get("heading_path") or [],
                            **({"inline_images": item.get("inline_images", [])} if is_email_thread else {}),
                            **({"memo_id": item.get("id", hit["_id"])} if is_memo else {})})
        if not embedding:
            results.sort(key=lambda item: item["score"], reverse=True)
        selected_results = results[:size]
        selected_sources = [
            f"{item.get('source') or 'document'}:{item.get('title') or '(untitled)'}"
            for item in selected_results
        ]
        logger.info(
            "[knowledge_collection_search] collection=%s query=%r hits=%d sources=%s",
            collection_id,
            query,
            len(selected_results),
            selected_sources,
        )
        return selected_results, str(source.get("instruction", "")).strip()
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

        language = detect_language(q)
        source_fields = ["title", "content", "id", "source", "updated_at"]
        bm25_res = await es.search(
            index=get_language_index("memo_documents", language), size=size * 4,
            _source=source_fields, query=_memo_bm25_query(q),
        )
        bm25_hits = bm25_res["hits"]["hits"]
        if embedding:
            knn_res = await es.search(
                index=MEMO_INDEX, size=size * 4, _source=source_fields,
                knn={"field": "embedding", "query_vector": embedding, "k": size * 4, "num_candidates": size * 20},
            )
            hits = _rrf_hits(bm25_hits, knn_res["hits"]["hits"], size * 2)
        else:
            logger.warning("[memo_search] 임베딩 실패, BM25 fallback")
            hits = bm25_hits

        quicknote_result = await quicknote_search(q, size=size, embedding=embedding)
        hits_info = [(h["_source"].get("title", ""), round(h.get("_score") or 0, 3)) for h in hits]
        logger.info("[memo_search] query=%r hits=%d scores=%s", q, len(hits), hits_info)
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
            for h in hits[:size]
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
        language = detect_language(query)
        source_fields = ["id", "title", "content", "done", "updated_at"]
        bm25_res = await es.search(
            index=get_language_index("quick_notes", language), size=size * 4,
            _source=source_fields,
            query={"match": {"content": {"query": query, "minimum_should_match": "30%"}}},
        )
        if embedding:
            knn_res = await es.search(
                index=QUICKNOTE_INDEX, size=size * 4, _source=source_fields,
                knn={"field": "embedding", "query_vector": embedding, "k": size * 4, "num_candidates": size * 20},
            )
            hits = _rrf_hits(bm25_res["hits"]["hits"], knn_res["hits"]["hits"], size)
        else:
            logger.warning("[quicknote_search] 임베딩 실패, BM25 fallback")
            hits = bm25_res["hits"]["hits"][:size]

        return [
            {
                "title": "빠른 메모" + (" (완료)" if h["_source"].get("done") else ""),
                "content": h["_source"]["content"],
                "url": f"quicknote://{h['_source'].get('id', h['_id'])}",
                "source": "quicknote",
                "indexed_at": h["_source"].get("updated_at", ""),
                "score": round(h.get("_score") or 0, 3),
                "quicknote_id": h["_source"].get("id", h["_id"]),
            }
            for h in hits
        ]
    except Exception as e:
        logger.warning("[quicknote_search] 실패: %s", e)
        return []
    finally:
        await es.close()
