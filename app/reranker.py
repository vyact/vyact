"""
reranker.py — BGE Reranker v2 m3 전역 로드 및 재정렬
sentence-transformers 기반
서버 시작 시 한 번만 로드, 이후 인터넷 없이 로컬 캐시 사용
"""
import asyncio
import time
import gc

import torch
from huggingface_hub import try_to_load_from_cache
from sentence_transformers import CrossEncoder
from concurrent.futures import ThreadPoolExecutor
from logger import get_logger

logger = get_logger(__name__)

_reranker = None
_executor = ThreadPoolExecutor(max_workers=2)
MODEL_NAME = "BAAI/bge-reranker-v2-m3"
RERANK_PASSAGE_MAX_CHARS = 1200
RERANKER_WARMUP_QUERY = "로컬 검색과 관련된 문서를 찾아주세요."
RERANKER_WARMUP_PASSAGES = (
    ("로컬 검색은 기기의 색인에서 질문과 관련된 문서 내용을 찾아 제공합니다. " * 40)[:RERANK_PASSAGE_MAX_CHARS],
    ("음성 인식은 녹음된 사용자의 목소리를 검색 가능한 텍스트로 변환합니다. " * 40)[:RERANK_PASSAGE_MAX_CHARS],
    ("음성 합성은 인공지능이 생성한 답변을 기기에서 자연스러운 소리로 읽습니다. " * 40)[:RERANK_PASSAGE_MAX_CHARS],
    ("리랭커는 검색된 후보 문서의 관련도를 평가하여 가장 유용한 결과를 선택합니다. " * 40)[:RERANK_PASSAGE_MAX_CHARS],
)


def _create_reranker(device: str, dtype: torch.dtype, force_download: bool):
    options = dict(device=device, max_length=512, model_kwargs={"dtype": dtype})
    cached = try_to_load_from_cache(MODEL_NAME, "config.json")
    if isinstance(cached, str):
        try:
            model = CrossEncoder(MODEL_NAME, local_files_only=True, **options)
            logger.info("[reranker] Loaded from local cache")
            return model
        except Exception:
            if not force_download:
                raise
            logger.info("[reranker] Local cache load failed — retrying with download allowed")
    return CrossEncoder(MODEL_NAME, local_files_only=False, **options)


def _release_reranker():
    global _reranker
    _reranker = None
    gc.collect()
    if torch.backends.mps.is_available():
        torch.mps.empty_cache()


def load_reranker(force_download: bool = False, *, use_fp16: bool = True):
    """Load cached weights; prefer FP16 on MPS with an FP32 retry."""
    global _reranker
    device = "mps" if torch.backends.mps.is_available() else "cpu"
    dtypes = (torch.float16, torch.float32) if device == "mps" and use_fp16 else (torch.float32,)
    for dtype in dtypes:
        logger.info("[reranker] Loading model: %s (device=%s, dtype=%s)", MODEL_NAME, device, dtype)
        try:
            _reranker = _create_reranker(device, dtype, force_download)
            logger.info("[reranker] Model loaded (device=%s, dtype=%s)", device, dtype)
            return True
        except Exception as error:
            logger.warning("[reranker] Load failed (device=%s, dtype=%s): %s", device, dtype, error)
        # Release failed-attempt resources after the exception traceback is cleared.
        _release_reranker()
        if dtype == torch.float16:
            logger.warning("[reranker] Retrying load with FP32")
    return False


def is_available() -> bool:
    return _reranker is not None


def warmup_reranker() -> bool:
    """Run one representative inference without depending on user ES data."""
    if not _reranker:
        return False

    started_at = time.perf_counter()
    try:
        _reranker.rank(
            RERANKER_WARMUP_QUERY,
            list(RERANKER_WARMUP_PASSAGES),
            return_documents=False,
        )
        logger.info(
            "[reranker] Inference warm-up done (duration_ms=%.1f, passages=%d)",
            (time.perf_counter() - started_at) * 1000,
            len(RERANKER_WARMUP_PASSAGES),
        )
        return True
    except Exception as error:
        logger.warning("[reranker] Inference warm-up failed: %s", error)
    if next(_reranker.model.parameters()).dtype == torch.float16:
        logger.warning("[reranker] Retrying warm-up with FP32")
        _release_reranker()
        if load_reranker(use_fp16=False):
            return warmup_reranker()
    return False


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
