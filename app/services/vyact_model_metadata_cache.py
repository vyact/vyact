"""Persistent GGUF memory analysis cache backed by Elasticsearch."""
import hashlib
from datetime import datetime, timezone

from elasticsearch import NotFoundError

from services.db import VYACT_MODEL_METADATA_INDEX, get_es

MODEL_METADATA_PARSER_VERSION = "@huggingface/gguf-0.4.6+q8-kv-v1"


def build_model_metadata_id(repository: str, filename: str, revision: str, context_size: int) -> str:
    identity = "\0".join((repository, filename, revision, str(context_size)))
    return hashlib.sha256(identity.encode("utf-8")).hexdigest()


async def _ensure_model_metadata_index(es) -> None:
    if await es.indices.exists(index=VYACT_MODEL_METADATA_INDEX):
        return
    await es.indices.create(
        index=VYACT_MODEL_METADATA_INDEX,
        settings={"number_of_shards": 1, "number_of_replicas": 0},
        mappings={"properties": {
            "repository": {"type": "keyword"},
            "filename": {"type": "keyword"},
            "revision": {"type": "keyword"},
            "context_size": {"type": "integer"},
            "architecture": {"type": "keyword"},
            "parameter_count": {"type": "long"},
            "context_length": {"type": "integer"},
            "block_count": {"type": "integer"},
            "quantization": {"type": "keyword"},
            "kv_cache_bytes": {"type": "long"},
            "runtime_buffer_bytes": {"type": "long"},
            "estimated_memory_bytes": {"type": "long"},
            "file_size_bytes": {"type": "long"},
            "parser_version": {"type": "keyword"},
            "calculated_at": {"type": "date"},
        }},
    )


async def get_cached_model_metadata(
        repository: str, filename: str, revision: str, context_size: int,
) -> dict | None:
    es = get_es()
    await _ensure_model_metadata_index(es)
    document_id = build_model_metadata_id(repository, filename, revision, context_size)
    try:
        response = await es.get(index=VYACT_MODEL_METADATA_INDEX, id=document_id)
    except NotFoundError:
        return None
    source = response.get("_source")
    if not source or source.get("parser_version") != MODEL_METADATA_PARSER_VERSION:
        return None
    return source


async def save_cached_model_metadata(
        repository: str, filename: str, revision: str, context_size: int, metadata: dict,
) -> str:
    es = get_es()
    await _ensure_model_metadata_index(es)
    document_id = build_model_metadata_id(repository, filename, revision, context_size)
    document = {
        "repository": repository,
        "filename": filename,
        "revision": revision,
        "context_size": context_size,
        **metadata,
        "parser_version": MODEL_METADATA_PARSER_VERSION,
        "calculated_at": datetime.now(timezone.utc).isoformat(),
    }
    await es.index(
        index=VYACT_MODEL_METADATA_INDEX,
        id=document_id,
        document=document,
        refresh="wait_for",
    )
    return document_id
