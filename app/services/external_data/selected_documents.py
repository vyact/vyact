"""Load explicitly selected external-data records as full LLM context documents."""

import asyncio
import json

from services.db import get_es
from services.external_data.biz_support import INDEX_NAME as BIZ_SUPPORT_INDEX
from services.external_data.gov24 import INDEX_NAME as GOV24_INDEX
from services.external_data.housing import INDEX_NAME as HOUSING_INDEX
from services.external_data.k_startup import INDEX_NAME as K_STARTUP_INDEX
from services.external_data.lh_lease_complex import INDEX_NAME as LH_COMPLEX_INDEX
from services.external_data.lh_lease_notice import INDEX_NAME as LH_NOTICE_INDEX
from services.external_data.welfare import INDEX_NAME as WELFARE_INDEX

SOURCE_INDEXES = {
    "kr.gov24": GOV24_INDEX,
    "kr.biz_support": BIZ_SUPPORT_INDEX,
    "kr.k_startup": K_STARTUP_INDEX,
    "kr.welfare": WELFARE_INDEX,
    "kr.housing": HOUSING_INDEX,
    "kr.lh_lease_complex": LH_COMPLEX_INDEX,
    "kr.lh_lease_notice": LH_NOTICE_INDEX,
}

CONTEXT_FIELDS = (
    "title", "agency", "target", "category", "user_type", "support_type", "summary",
    "purpose", "content", "content_text", "selection_criteria", "application_method",
    "required_documents", "contact", "application_deadline", "application_end_date",
    "source_modified_at", "source_url", "raw",
)


async def _load_source_documents(source_id: str, document_ids: list[str]) -> list[dict]:
    es = get_es()
    try:
        result = await es.mget(index=SOURCE_INDEXES[source_id], ids=document_ids)
    finally:
        await es.close()
    documents = []
    for document in result.get("docs", []):
        if not document.get("found"):
            continue
        source = document.get("_source", {})
        full_content = {
            field: source.get(field)
            for field in CONTEXT_FIELDS
            if source.get(field) not in (None, "", [], {})
        }
        documents.append({
            "id": source.get("external_id") or document.get("_id", ""),
            "title": source.get("title") or "External data",
            "content": json.dumps(full_content, ensure_ascii=False, default=str),
            "source": source_id,
            "external_resource_id": source_id,
            "url": source.get("source_url", ""),
            "score": 1.0,
            "indexed_at": source.get("source_modified_at", ""),
            "direct_document": True,
        })
    return documents


async def load_selected_external_documents(selections: list[dict]) -> list[dict]:
    grouped: dict[str, list[str]] = {}
    for selection in selections:
        source_id = str(selection.get("source_id") or "")
        document_id = str(selection.get("document_id") or "")
        if source_id in SOURCE_INDEXES and document_id:
            grouped.setdefault(source_id, []).append(document_id)
    if not grouped:
        return []
    results = await asyncio.gather(*(
        _load_source_documents(source_id, list(dict.fromkeys(document_ids)))
        for source_id, document_ids in grouped.items()
    ), return_exceptions=True)
    return [document for result in results if isinstance(result, list) for document in result]


def merge_external_context_documents(
        selected_documents: list[dict],
        search_results: list[dict],
) -> list[dict]:
    """직접 선택 문서를 우선하면서 서비스 검색 결과의 동일 문서를 제거한다."""
    merged: list[dict] = []
    seen: set[tuple[str, str]] = set()
    for document in [*selected_documents, *search_results]:
        source_id = str(document.get("external_resource_id") or document.get("source") or "")
        document_id = str(document.get("id") or "")
        fallback = str(document.get("url") or document.get("title") or "")
        identity = (source_id, document_id or fallback)
        if not identity[1] or identity in seen:
            continue
        seen.add(identity)
        merged.append(document)
    return merged
