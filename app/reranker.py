"""
reranker.py — BGE Reranker v2 m3 전역 로드 및 재정렬
sentence-transformers 5.6.x 기준
서버 시작 시 한 번만 로드, 이후 인터넷 없이 로컬 캐시 사용
"""
import asyncio
from concurrent.futures import ThreadPoolExecutor
from logger import get_logger

logger = get_logger(__name__)

_reranker = None
_executor = ThreadPoolExecutor(max_workers=2)
MODEL_NAME = "BAAI/bge-reranker-v2-m3"
RERANK_PASSAGE_MAX_CHARS = 1200


def load_reranker(force_download: bool = False):
    """서버 시작 시 호출 — 모델 로드 (블로킹)"""
    global _reranker
    try:
        from sentence_transformers import CrossEncoder
        import torch
        device = "mps" if torch.backends.mps.is_available() else "cpu"
        logger.info("[reranker] Loading model: %s (device=%s)", MODEL_NAME, device)
        # 캐시 확인 후 local_files_only로 로드 (HuggingFace 요청 차단)
        import os
        from huggingface_hub import try_to_load_from_cache
        cached = try_to_load_from_cache(MODEL_NAME, "config.json")
        if cached is not None:
            try:
                _reranker = CrossEncoder(
                    MODEL_NAME,
                    device=device,
                    max_length=512,
                    local_files_only=True,
                )
                logger.info("[reranker] Loaded from local cache")
            except Exception:
                if not force_download:
                    raise
                logger.info("[reranker] Local cache is incomplete — resuming download")
                _reranker = None
        if _reranker is None:
            _reranker = CrossEncoder(
                MODEL_NAME,
                device=device,
                max_length=512,
                local_files_only=False,
            )
        logger.info("[reranker] Model loaded")
        return True
    except Exception as e:
        logger.warning("[reranker] 모델 로딩 실패 (리랭킹 비활성화): %s", e)
        _reranker = None
        return False


def is_available() -> bool:
    return _reranker is not None


def _rerank_sync(query: str, docs: list[dict], top_k: int) -> list[dict]:
    """동기 리랭킹 — executor에서 실행"""
    if not _reranker or not docs:
        return docs[:top_k]

    # model.rank() 사용 (5.x 권장 방식)
    passages = []
    for document in docs:
        heading_path = " > ".join(document.get("heading_path") or [])
        metadata = "\n".join(part for part in (document.get("title", ""), heading_path) if part)
        passages.append(f"{metadata}\n{document.get('content', '')[:RERANK_PASSAGE_MAX_CHARS]}")
    ranks = _reranker.rank(query, passages, return_documents=False)

    # ranks: [{"corpus_id": int, "score": float}, ...]
    ranked_docs = []
    for r in ranks[:top_k]:
        d = dict(docs[r["corpus_id"]])
        d["rerank_score"] = round(float(r["score"]), 6)
        ranked_docs.append(d)

    logger.info(
        "[reranker] selected top %d: %s",
        top_k,
        [(d["title"][:20], f"{d['rerank_score']:.6f}") for d in ranked_docs],
    )
    return ranked_docs


async def rerank(query: str, docs: list[dict], top_k: int = 5) -> list[dict]:
    """비동기 리랭킹 — 이벤트 루프 블로킹 방지"""
    if not _reranker or not docs:
        return docs[:top_k]
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(
        _executor, _rerank_sync, query, docs, top_k
    )
