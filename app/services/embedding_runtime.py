"""Local, provider-independent embedding runtime used by Vyact."""
from __future__ import annotations

import asyncio
import hashlib
import math
from pathlib import Path
from typing import Any

from config import INSTALL_DIR
from config.embeddings import (
    EMBEDDING_MODEL_FILENAME,
    EMBEDDING_MODEL_ID,
    EMBEDDING_MODEL_REVISION,
    EMBEDDING_MODEL_SHA256,
)
from logger import get_logger
from services.runtime_settings import get_runtime_settings

logger = get_logger(__name__)

EMBEDDING_MODEL_DIR = INSTALL_DIR / "models" / "embeddings"
EMBEDDING_BATCH_TOKEN_BUDGET = 2048
# Encoder 모델은 개별 입력 전체가 micro-batch에 들어가야 한다. 실제 요청 묶음과
# 런타임 버퍼를 2,048토큰으로 맞춰, 긴 메일 청크를 처리하면서도 로컬 메모리 사용량을
# 과도하게 늘리지 않는다.
EMBEDDING_RUNTIME_BATCH_TOKENS = EMBEDDING_BATCH_TOKEN_BUDGET
_model: Any | None = None
_model_context_size: int | None = None
# llama.cpp Llama 인스턴스는 동시 tokenize/create_embedding 호출에 안전하지 않다.
# 파일 청크를 asyncio.gather로 임베딩할 때 이 락이 없으면 네이티브 코드가 SIGSEGV로
# 프로세스 전체를 종료할 수 있으므로, 모델 로드와 추론을 하나의 큐로 직렬화한다.
_embedding_lock = asyncio.Lock()


class EmbeddingContextExceeded(Exception):
    """Raised when a text exceeds Vyact's configured embedding context window."""


def _configured_context_size() -> int:
    return int(get_runtime_settings()["bge_num_ctx"])


def _model_path() -> Path:
    return EMBEDDING_MODEL_DIR / EMBEDDING_MODEL_FILENAME


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _ensure_model_file() -> Path:
    """Download the pinned model once and reject altered/incomplete cache files."""
    path = _model_path()
    if path.exists() and _sha256(path) == EMBEDDING_MODEL_SHA256:
        return path

    if path.exists():
        path.unlink()

    from huggingface_hub import hf_hub_download

    EMBEDDING_MODEL_DIR.mkdir(parents=True, exist_ok=True)
    downloaded = Path(hf_hub_download(
        repo_id=EMBEDDING_MODEL_ID,
        filename=EMBEDDING_MODEL_FILENAME,
        revision=EMBEDDING_MODEL_REVISION,
        local_dir=str(EMBEDDING_MODEL_DIR),
    ))
    if _sha256(downloaded) != EMBEDDING_MODEL_SHA256:
        downloaded.unlink(missing_ok=True)
        raise RuntimeError("Vyact embedding model integrity check failed")
    return downloaded


def _load_model_sync() -> Any:
    global _model, _model_context_size
    context_size = _configured_context_size()
    if _model is not None and _model_context_size == context_size:
        return _model

    if _model is not None:
        close = getattr(_model, "close", None)
        if callable(close):
            close()
        _model = None
        _model_context_size = None

    from llama_cpp import Llama

    path = _ensure_model_file()
    _model = Llama(
        model_path=str(path),
        embedding=True,
        n_ctx=context_size,
        n_batch=min(EMBEDDING_RUNTIME_BATCH_TOKENS, context_size),
        n_ubatch=min(EMBEDDING_RUNTIME_BATCH_TOKENS, context_size),
        n_gpu_layers=-1,
        verbose=False,
    )
    _model_context_size = context_size
    return _model


async def prepare_embedding_model() -> Path:
    """Ensure the immutable model file is cached without retaining it in memory."""
    return await asyncio.to_thread(_ensure_model_file)


def _normalize_embedding(vector: list[float]) -> list[float]:
    norm = math.sqrt(sum(value * value for value in vector))
    return [value / norm for value in vector] if norm else vector


def _build_embedding_batches(
    items: list[tuple[int, str, int]], batch_token_budget: int,
) -> list[list[tuple[int, str, int]]]:
    """Group input fragments into native batches below the llama.cpp token limit."""
    batches: list[list[tuple[int, str, int]]] = []
    batch: list[tuple[int, str, int]] = []
    batch_tokens = 0
    for input_index, text, token_count in items:
        if batch and batch_tokens + token_count > batch_token_budget:
            batches.append(batch)
            batch = []
            batch_tokens = 0
        batch.append((input_index, text, token_count))
        batch_tokens += token_count
    if batch:
        batches.append(batch)
    return batches


def _split_embedding_input(
    model: Any, text: str, context_size: int, batch_token_budget: int,
) -> list[tuple[str, int]]:
    """Split one long input so every native encoder call fits its micro-batch."""
    tokens = model.tokenize(text.encode("utf-8"))
    if len(tokens) > context_size:
        raise EmbeddingContextExceeded(
            f"Embedding input exceeds the configured maximum of {context_size} tokens"
        )
    if len(tokens) <= batch_token_budget:
        return [(text, len(tokens))]

    fragments: list[tuple[str, int]] = []
    for start in range(0, len(tokens), batch_token_budget):
        token_fragment = tokens[start:start + batch_token_budget]
        fragment = model.detokenize(token_fragment).decode("utf-8", errors="replace")
        fragments.append((fragment, len(token_fragment)))
    return fragments


def _mean_embedding(vectors: list[tuple[list[float], int]]) -> list[float]:
    if len(vectors) == 1:
        return _normalize_embedding(vectors[0][0])
    dimensions = len(vectors[0][0])
    total_tokens = sum(token_count for _, token_count in vectors)
    averaged = [
        sum(vector[dimension] * token_count for vector, token_count in vectors) / total_tokens
        for dimension in range(dimensions)
    ]
    return _normalize_embedding(averaged)


async def get_embeddings(texts: list[str], raise_on_context_exceeded: bool = False) -> list[list[float] | None]:
    """Embed multiple texts in safe token-budgeted batches using one Llama instance."""
    if not texts:
        return []
    try:
        async with _embedding_lock:
            model = await asyncio.to_thread(_load_model_sync)
            context_size = _model_context_size or _configured_context_size()
            batch_token_budget = min(EMBEDDING_BATCH_TOKEN_BUDGET, context_size)
            vectors_by_input: list[list[tuple[list[float], int]]] = [[] for _ in texts]
            fragments: list[tuple[int, str, int]] = []
            for input_index, input_text in enumerate(texts):
                try:
                    fragments.extend(
                        (input_index, fragment, token_count)
                        for fragment, token_count in _split_embedding_input(
                            model, input_text, context_size, batch_token_budget,
                        )
                    )
                except EmbeddingContextExceeded:
                    if raise_on_context_exceeded:
                        raise
                    logger.warning("Embedding input %d exceeded the configured context window", input_index)
            for batch in _build_embedding_batches(fragments, batch_token_budget):
                try:
                    response = await asyncio.to_thread(model.create_embedding, [text for _, text, _ in batch])
                    response_vectors = [item["embedding"] for item in response["data"]]
                    if len(response_vectors) != len(batch):
                        raise RuntimeError("Embedding response count does not match input count")
                    for (input_index, _, token_count), vector in zip(batch, response_vectors):
                        vectors_by_input[input_index].append((vector, token_count))
                except Exception as batch_error:
                    logger.warning("Embedding batch failed; retrying %d inputs separately: %s", len(batch), batch_error)
                    for input_index, fragment, token_count in batch:
                        try:
                            response = await asyncio.to_thread(model.create_embedding, [fragment])
                            vectors_by_input[input_index].append((response["data"][0]["embedding"], token_count))
                        except Exception as input_error:
                            logger.warning("Embedding input %d failed: %s", input_index, input_error)
        return [_mean_embedding(vectors) if vectors else None for vectors in vectors_by_input]
    except EmbeddingContextExceeded:
        if raise_on_context_exceeded:
            raise
        logger.warning("Embedding input exceeded the configured context window")
        return [None] * len(texts)
    except Exception as exc:
        logger.exception("Vyact embedding failed: %s", exc)
        return [None] * len(texts)


async def get_embedding(text: str, is_query: bool = False, raise_on_context_exceeded: bool = False) -> list[float] | None:
    """Return a normalized BGE-M3 vector without relying on any LLM provider."""
    del is_query  # BGE-M3 GGUF uses the same embedding input for documents and queries.
    return (await get_embeddings([text], raise_on_context_exceeded=raise_on_context_exceeded))[0]
