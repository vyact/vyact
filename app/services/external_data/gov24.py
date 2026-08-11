"""Synchronize Government24 public-benefit data into Elasticsearch."""

import asyncio
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk, async_scan

from services.db import SETTINGS_INDEX, get_es

SOURCE_ID = "kr.gov24"
INDEX_NAME = "external_data_kr_gov24"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_gov24"
API_BASE_URL = "https://api.odcloud.kr/api/gov24/v3"
PAGE_SIZE = 100
INACTIVE_AFTER_MISSING_SYNCS = 3

ENDPOINTS = {
    "list": "serviceList",
    "detail": "serviceDetail",
    "conditions": "supportConditions",
}

_sync_tasks: set[asyncio.Task] = set()
_sync_lock = asyncio.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _save_sync_status(status: dict) -> None:
    es = get_es()
    try:
        await es.index(
            index=SETTINGS_INDEX,
            id=SYNC_STATUS_DOC_ID,
            document={"key": SYNC_STATUS_DOC_ID, "value": status},
            refresh=True,
        )
    finally:
        await es.close()


async def get_sync_status() -> dict:
    es = get_es()
    try:
        result = await es.get(index=SETTINGS_INDEX, id=SYNC_STATUS_DOC_ID, ignore=[404])
        if not result.get("found"):
            return {"status": "idle", "document_count": 0}
        status = result["_source"].get("value", {})
        return status if isinstance(status, dict) else {"status": "idle", "document_count": 0}
    finally:
        await es.close()


async def _ensure_index() -> None:
    es = get_es()
    try:
        if await es.indices.exists(index=INDEX_NAME):
            return
        await es.indices.create(
            index=INDEX_NAME,
            settings={"number_of_shards": 1, "number_of_replicas": 0},
            mappings={"properties": {
                "source_id": {"type": "keyword"},
                "external_id": {"type": "keyword"},
                "lifecycle_status": {"type": "keyword"},
                "missing_sync_count": {"type": "integer"},
                "title": {"type": "text"},
                "content_text": {"type": "text"},
                "support_type": {"type": "keyword"},
                "target": {"type": "text"},
                "category": {"type": "keyword"},
                "user_type": {"type": "keyword"},
                "agency": {"type": "keyword"},
                "application_deadline": {"type": "text"},
                "source_url": {"type": "keyword", "index": False},
                "source_modified_at": {"type": "keyword"},
                "fetched_at": {"type": "date"},
                "last_seen_at": {"type": "date"},
                "raw": {"type": "object", "enabled": False},
            }},
        )
    finally:
        await es.close()


def _normalize_service_key(service_key: str) -> str:
    stripped_key = service_key.strip()
    return unquote(stripped_key) if "%" in stripped_key else stripped_key


async def _fetch_dataset(
    client: httpx.AsyncClient,
    endpoint: str,
    service_key: str,
    progress_callback,
) -> list[dict]:
    records: list[dict] = []
    page = 1
    while True:
        response = await client.get(
            f"{API_BASE_URL}/{endpoint}",
            params={
                "page": page,
                "perPage": PAGE_SIZE,
                "returnType": "JSON",
                "serviceKey": _normalize_service_key(service_key),
            },
        )
        response.raise_for_status()
        payload = response.json()
        page_records = payload.get("data")
        if not isinstance(page_records, list):
            raise ValueError("정부24 API 응답에 data 목록이 없습니다.")
        records.extend(item for item in page_records if isinstance(item, dict))
        total_count = int(payload.get("matchCount") or payload.get("totalCount") or len(records))
        await progress_callback(len(records), total_count)
        if not page_records or len(records) >= total_count:
            break
        page += 1
    return records


def _build_document(list_item: dict, detail: dict, conditions: dict, fetched_at: str) -> dict:
    text_parts = [
        list_item.get("서비스명"), list_item.get("서비스목적요약"), list_item.get("지원대상"),
        list_item.get("선정기준"), list_item.get("지원내용"), list_item.get("신청방법"),
        detail.get("서비스목적"), detail.get("구비서류"), detail.get("문의처"),
    ]
    condition_labels = [
        value for key, value in conditions.items()
        if key.startswith("JA") and value not in (None, "", 0, "0")
    ]
    return {
        "source_id": SOURCE_ID,
        "external_id": str(list_item["서비스ID"]),
        "lifecycle_status": "active",
        "missing_sync_count": 0,
        "title": list_item.get("서비스명", ""),
        "content_text": "\n".join(str(value) for value in [*text_parts, *condition_labels] if value),
        "support_type": list_item.get("지원유형", ""),
        "target": list_item.get("지원대상", ""),
        "category": list_item.get("서비스분야", ""),
        "user_type": list_item.get("사용자구분", ""),
        "agency": list_item.get("소관기관명", ""),
        "application_deadline": detail.get("신청기한") or list_item.get("신청기한", ""),
        "source_url": detail.get("온라인신청사이트URL") or list_item.get("상세조회URL", ""),
        "source_modified_at": detail.get("수정일시") or list_item.get("수정일시", ""),
        "fetched_at": fetched_at,
        "last_seen_at": fetched_at,
        "raw": {"list": list_item, "detail": detail, "conditions": conditions},
    }


async def _mark_missing_documents(active_ids: set[str], fetched_at: str) -> tuple[int, int]:
    es = get_es()
    possibly_removed = inactive = 0
    try:
        actions = []
        async for hit in async_scan(
            es,
            index=INDEX_NAME,
            query={"query": {"match_all": {}}, "_source": ["external_id", "missing_sync_count"]},
        ):
            source = hit.get("_source", {})
            external_id = str(source.get("external_id", ""))
            if not external_id or external_id in active_ids:
                continue
            missing_count = int(source.get("missing_sync_count") or 0) + 1
            lifecycle_status = "inactive" if missing_count >= INACTIVE_AFTER_MISSING_SYNCS else "possibly_removed"
            inactive += lifecycle_status == "inactive"
            possibly_removed += lifecycle_status == "possibly_removed"
            actions.append({
                "_op_type": "update",
                "_index": INDEX_NAME,
                "_id": hit["_id"],
                "doc": {
                    "lifecycle_status": lifecycle_status,
                    "missing_sync_count": missing_count,
                    "fetched_at": fetched_at,
                },
            })
        if actions:
            await async_bulk(es, actions, refresh=True, raise_on_error=False)
    finally:
        await es.close()
    return possibly_removed, inactive


async def synchronize(service_key: str) -> None:
    async with _sync_lock:
        started_at = _utc_now()
        status = {
            "status": "running",
            "stage": "list",
            "current": 0,
            "total": 0,
            "started_at": started_at,
            "last_successful_sync_at": (await get_sync_status()).get("last_successful_sync_at"),
        }
        await _save_sync_status(status)
        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                datasets: dict[str, list[dict]] = {}
                for stage, endpoint in ENDPOINTS.items():
                    status.update({"stage": stage, "current": 0, "total": 0})
                    await _save_sync_status(status)

                    async def update_progress(current: int, total: int) -> None:
                        status.update({"current": current, "total": total})
                        await _save_sync_status(status)

                    datasets[stage] = await _fetch_dataset(client, endpoint, service_key, update_progress)

            await _ensure_index()
            fetched_at = _utc_now()
            details = {str(item.get("서비스ID")): item for item in datasets["detail"] if item.get("서비스ID")}
            conditions = {str(item.get("서비스ID")): item for item in datasets["conditions"] if item.get("서비스ID")}
            documents = []
            active_ids: set[str] = set()
            for item in datasets["list"]:
                external_id = str(item.get("서비스ID", ""))
                if not external_id:
                    continue
                active_ids.add(external_id)
                documents.append({
                    "_op_type": "index",
                    "_index": INDEX_NAME,
                    "_id": external_id,
                    "_source": _build_document(
                        item,
                        details.get(external_id, {}),
                        conditions.get(external_id, {}),
                        fetched_at,
                    ),
                })

            es = get_es()
            try:
                if documents:
                    indexed_count, indexing_errors = await async_bulk(
                        es,
                        documents,
                        refresh=True,
                        raise_on_error=False,
                    )
                    if indexing_errors:
                        raise RuntimeError(
                            f"정부24 데이터 {len(indexing_errors)}건을 Elasticsearch에 저장하지 못했습니다."
                        )
                    if indexed_count != len(documents):
                        raise RuntimeError("정부24 데이터 일부가 Elasticsearch에 저장되지 않았습니다.")
            finally:
                await es.close()
            possibly_removed, inactive = await _mark_missing_documents(active_ids, fetched_at)
            await _save_sync_status({
                "status": "completed",
                "stage": "completed",
                "current": len(documents),
                "total": len(documents),
                "document_count": len(documents),
                "possibly_removed_count": possibly_removed,
                "inactive_count": inactive,
                "started_at": started_at,
                "completed_at": fetched_at,
                "last_successful_sync_at": fetched_at,
            })
        except Exception as error:
            await _save_sync_status({
                **status,
                "status": "failed",
                "failed_at": _utc_now(),
                "error": str(error),
            })


def start_synchronization(service_key: str) -> bool:
    if _sync_lock.locked() or any(not task.done() for task in _sync_tasks):
        return False
    task = asyncio.create_task(synchronize(service_key), name="external-data-kr-gov24-sync")
    _sync_tasks.add(task)
    task.add_done_callback(_sync_tasks.discard)
    return True
