"""Local, provider-independent embedding runtime used by Vyact."""
from __future__ import annotations

import asyncio
import hashlib
import math
from pathlib import Path
from typing import Any

from config import INSTALL_DIR
from config.embeddings import (
    EMBEDDING_MAX_TOKENS,
    EMBEDDING_MODEL_FILENAME,
    EMBEDDING_MODEL_ID,
    EMBEDDING_MODEL_REVISION,
    EMBEDDING_MODEL_SHA256,
)
from logger import get_logger

logger = get_logger(__name__)

EMBEDDING_MODEL_DIR = INSTALL_DIR / "models" / "embeddings"
_model: Any | None = None
_load_lock = asyncio.Lock()


class EmbeddingContextExceeded(Exception):
    """Raised when a text exceeds Vyact's fixed embedding context window."""


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
    global _model
    if _model is not None:
        return _model

    from llama_cpp import Llama

    path = _ensure_model_file()
    _model = Llama(
        model_path=str(path),
        embedding=True,
        n_ctx=EMBEDDING_MAX_TOKENS,
        n_gpu_layers=-1,
        verbose=False,
    )
    return _model


async def prepare_embedding_model() -> Path:
    """Ensure the immutable model file is cached without retaining it in memory."""
    return await asyncio.to_thread(_ensure_model_file)


async def get_embedding(text: str, is_query: bool = False, raise_on_context_exceeded: bool = False) -> list[float] | None:
    """Return a normalized BGE-M3 vector without relying on any LLM provider."""
    del is_query  # BGE-M3 GGUF uses the same embedding input for documents and queries.
    try:
        async with _load_lock:
            model = await asyncio.to_thread(_load_model_sync)
        token_count = len(model.tokenize(text.encode("utf-8")))
        if token_count > EMBEDDING_MAX_TOKENS:
            raise EmbeddingContextExceeded(
                f"Embedding input has {token_count} tokens; maximum is {EMBEDDING_MAX_TOKENS}"
            )
        response = await asyncio.to_thread(model.create_embedding, text)
        vector = response["data"][0]["embedding"]
        norm = math.sqrt(sum(value * value for value in vector))
        return [value / norm for value in vector] if norm else vector
    except EmbeddingContextExceeded:
        if raise_on_context_exceeded:
            raise
        logger.warning("Embedding input exceeded the fixed context window")
        return None
    except Exception as exc:
        logger.exception("Vyact embedding failed: %s", exc)
        return None
