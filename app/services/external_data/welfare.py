"""Synchronize central-government welfare services from the Bokjiro public API."""

import asyncio
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from time import monotonic
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk

from services.db import SETTINGS_INDEX, get_es
from services.external_data.quota import DailyRequestQuota
from services.external_data.retention import is_storable_by_deadline
from services.external_data.status_events import notify_status_changed

SOURCE_ID = "kr.welfare"
INDEX_NAME = "external_data_kr_welfare"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_welfare"
API_BASE_URL = "https://apis.data.go.kr/B554287/NationalWelfareInformationsV001"
LIST_ENDPOINT = "NationalWelfarelistV001"
DETAIL_ENDPOINT = "NationalWelfaredetailedV001"
PAGE_SIZE = 500
BULK_CHUNK_SIZE = 100
BROWSE_PAGE_SIZE = 40
DETAIL_CONCURRENCY = 5
DAILY_REQUEST_LIMIT = 100

_sync_tasks: set[asyncio.Task] = set()
_sync_lock = asyncio.Lock()


class WelfareApiError(ValueError):
    def __init__(self, message: str, error_code: str = "api_error") -> None:
        super().__init__(message)
        self.error_code = error_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_service_key(service_key: str) -> str:
    stripped_key = service_key.strip()
    return unquote(stripped_key) if "%" in stripped_key else stripped_key


def _plain_text(value: object) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", str(value or ""))
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _element_to_data(element: ET.Element) -> dict:
    data: dict = {}
    for child in element:
        value: object = _element_to_data(child) if list(child) else (child.text or "").strip()
        if child.tag in data:
            existing = data[child.tag]
            data[child.tag] = [*existing, value] if isinstance(existing, list) else [existing, value]
        else:
            data[child.tag] = value
    return data


def _parse_xml(content: str) -> ET.Element:
    try:
        root = ET.fromstring(content)
    except ET.ParseError as error:
        raise ValueError("복지로 API가 올바른 XML을 반환하지 않았습니다.") from error
    reason_code = (root.findtext(".//returnReasonCode") or "").strip()
    if reason_code:
        message = (
            root.findtext(".//returnAuthMsg")
            or root.findtext(".//errMsg")
            or "복지로 API 호출에 실패했습니다."
        ).strip()
        error_code = "request_limit_exceeded" if reason_code == "22" else "api_error"
        raise WelfareApiError(f"{message} ({reason_code})", error_code)
    result_code = (root.findtext(".//resultCode") or "0").strip()
    if result_code not in {"0", "00", "200"}:
        message = (root.findtext(".//resultMessage") or root.findtext(".//resultMsg") or "복지로 API 호출에 실패했습니다.").strip()
        error_code = "request_limit_exceeded" if result_code == "22" else "api_error"
        raise WelfareApiError(f"{message} ({result_code})", error_code)
    return root


def _parse_list_response(content: str) -> tuple[list[dict], int]:
    root = _parse_xml(content)
    records = [_element_to_data(element) for element in root.findall(".//servList")]
    total_text = root.findtext(".//totalCount") or str(len(records))
    return records, int(total_text or 0)


def _parse_detail_response(content: str) -> dict:
    root = _parse_xml(content)
    detail = root if root.tag == "wantedDtl" else root.find(".//wantedDtl")
    if detail is None:
        raise ValueError("복지로 API 상세 응답에 wantedDtl이 없습니다.")
    return _element_to_data(detail)


async def _fetch_list(client: httpx.AsyncClient, service_key: str, progress_callback, request_quota: DailyRequestQuota) -> list[dict]:
    records: list[dict] = []
    page = 1
    while True:
        if request_quota.exhausted:
            return records
        request_quota.consume()
        response = await client.get(
            f"{API_BASE_URL}/{LIST_ENDPOINT}",
            params={
                "serviceKey": _normalize_service_key(service_key),
                "callTp": "L",
                "pageNo": page,
                "numOfRows": PAGE_SIZE,
                "srchKeyCode": "003",
            },
        )
        response.raise_for_status()
        try:
            page_records, total = _parse_list_response(response.text)
        except WelfareApiError as error:
            if error.error_code != "request_limit_exceeded":
                raise
            request_quota.used = request_quota.limit
            return records
        records.extend(page_records)
        await progress_callback(len(records), total)
        if not page_records or len(records) >= total:
            break
        page += 1
    return records


async def _fetch_details(client: httpx.AsyncClient, service_key: str, records: list[dict], progress_callback, request_quota: DailyRequestQuota) -> dict[str, dict]:
    semaphore = asyncio.Semaphore(DETAIL_CONCURRENCY)
    details: dict[str, dict] = {}
    completed = 0
    progress_lock = asyncio.Lock()

    async def fetch_detail(record: dict) -> None:
        nonlocal completed
        service_id = str(record.get("servId") or "").strip()
        if not service_id:
            return
        async with semaphore:
            if request_quota.exhausted:
                return
            request_quota.consume()
            response = await client.get(
                f"{API_BASE_URL}/{DETAIL_ENDPOINT}",
                params={
                    "serviceKey": _normalize_service_key(service_key),
                    "callTp": "D",
                    "servId": service_id,
                },
            )
            response.raise_for_status()
            try:
                details[service_id] = _parse_detail_response(response.text)
            except WelfareApiError as error:
                if error.error_code != "request_limit_exceeded":
                    raise
                request_quota.used = request_quota.limit
                return
        async with progress_lock:
            completed += 1
            await progress_callback(completed, len(records))

    await asyncio.gather(*(fetch_detail(record) for record in records))
    return details


def _related_entries(detail: dict, key: str) -> list[dict]:
    value = detail.get(key, [])
    if isinstance(value, dict):
        return [value]
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _entry_text(detail: dict, key: str) -> str:
    return "\n".join(
        " · ".join(filter(None, [str(item.get("servSeDetailNm") or "").strip(), str(item.get("servSeDetailLink") or "").strip()]))
        for item in _related_entries(detail, key)
        if item.get("servSeDetailNm") or item.get("servSeDetailLink")
    )


def _build_document(list_item: dict, detail: dict, fetched_at: str) -> dict:
    service_id = str(list_item.get("servId") or detail.get("servId") or "").strip()
    title = _plain_text(list_item.get("servNm") or detail.get("servNm"))
    target = _plain_text(detail.get("tgtrDtlCn"))
    selection_criteria = _plain_text(detail.get("slctCritCn"))
    content = _plain_text(detail.get("alwServCn"))
    summary = _plain_text(list_item.get("servDgst") or detail.get("wlfareInfoOutlCn"))
    application_method = _entry_text(detail, "applmetList")
    contact = "\n".join(filter(None, [
        _plain_text(detail.get("rprsCtadr") or list_item.get("rprsCtadr")),
        _entry_text(detail, "inqplCtadrList"),
        _entry_text(detail, "inqplHmpgReldList"),
    ]))
    required_documents = _entry_text(detail, "basfrmList")
    source_url = str(list_item.get("servDtlLink") or "").strip()
    if not source_url:
        source_url = f"https://www.bokjiro.go.kr/ssis-tbu/twataa/wlfareInfo/moveTWAT52011M.do?wlfareInfoId={service_id}"
    category = _plain_text(detail.get("intrsThemaArray") or list_item.get("intrsThemaArray"))
    user_type = _plain_text(detail.get("lifeArray") or list_item.get("lifeArray"))
    household_type = _plain_text(detail.get("trgterIndvdlArray") or list_item.get("trgterIndvdlArray"))
    support_type = _plain_text(detail.get("srvPvsnNm") or list_item.get("srvPvsnNm"))
    sections = [
        ("서비스명", title), ("서비스 요약", summary), ("지원대상", target),
        ("선정기준", selection_criteria), ("서비스 내용", content),
        ("신청방법", application_method), ("문의처", contact),
        ("생애주기", user_type), ("가구유형", household_type),
        ("관심주제", category), ("제공유형", support_type),
    ]
    return {
        "source_id": SOURCE_ID,
        "external_id": service_id,
        "lifecycle_status": "active",
        "title": title,
        "content_text": "\n\n".join(f"{label}\n{value}" for label, value in sections if value),
        "agency": _plain_text(detail.get("jurMnofNm") or list_item.get("jurMnofNm") or list_item.get("jurOrgNm")),
        "target": target,
        "category": category,
        "user_type": " · ".join(filter(None, [user_type, household_type])),
        "support_type": support_type,
        "summary": summary,
        "purpose": _plain_text(detail.get("wlfareInfoOutlCn")),
        "content": content,
        "selection_criteria": selection_criteria,
        "application_method": application_method,
        "required_documents": required_documents,
        "contact": contact,
        "source_url": source_url,
        "source_modified_at": _plain_text(list_item.get("svcfrstRegTs") or detail.get("crtrYr")),
        "fetched_at": fetched_at,
        "raw": {"list": list_item, "detail": detail},
    }


async def _ensure_index() -> None:
    es = get_es()
    try:
        if await es.indices.exists(index=INDEX_NAME):
            return
        await es.indices.create(index=INDEX_NAME, settings={"number_of_shards": 1, "number_of_replicas": 0}, mappings={"properties": {
            "source_id": {"type": "keyword"}, "external_id": {"type": "keyword"},
            "lifecycle_status": {"type": "keyword"}, "title": {"type": "text"},
            "content_text": {"type": "text"}, "agency": {"type": "keyword"},
            "target": {"type": "text"}, "category": {"type": "keyword"},
            "user_type": {"type": "text"}, "support_type": {"type": "keyword"},
            "summary": {"type": "text"}, "purpose": {"type": "text"},
            "content": {"type": "text"}, "selection_criteria": {"type": "text"},
            "application_method": {"type": "text"}, "required_documents": {"type": "text"},
            "contact": {"type": "text"}, "source_url": {"type": "keyword", "index": False},
            "source_modified_at": {"type": "keyword"}, "fetched_at": {"type": "date"},
            "raw": {"type": "object", "enabled": False},
        }})
    finally:
        await es.close()


async def _save_sync_status(status: dict) -> None:
    es = get_es()
    try:
        await es.index(index=SETTINGS_INDEX, id=SYNC_STATUS_DOC_ID, document={"key": SYNC_STATUS_DOC_ID, "value": status}, refresh=False)
    finally:
        await es.close()
    await notify_status_changed(SOURCE_ID)


async def get_sync_status() -> dict:
    es = get_es()
    try:
        result = await es.get(index=SETTINGS_INDEX, id=SYNC_STATUS_DOC_ID, ignore=[404])
        if not result.get("found"):
            return {"status": "idle", "document_count": 0, "request_count": 0, "request_limit": DAILY_REQUEST_LIMIT}
        value = result["_source"].get("value", {})
        if not isinstance(value, dict):
            return {"status": "idle", "document_count": 0, "request_count": 0, "request_limit": DAILY_REQUEST_LIMIT}
        return {**value, **DailyRequestQuota.from_status(value, DAILY_REQUEST_LIMIT).status_fields()}
    finally:
        await es.close()


async def synchronize(service_key: str) -> None:
    async with _sync_lock:
        started_at = _utc_now()
        previous = await get_sync_status()
        request_quota = DailyRequestQuota.from_status(previous, DAILY_REQUEST_LIMIT)
        status = {"status": "running", "stage": "welfareList", "current": 0, "total": 0, "started_at": started_at, "document_count": previous.get("document_count", 0), "last_successful_sync_at": previous.get("last_successful_sync_at"), **request_quota.status_fields()}
        await _save_sync_status(status)
        try:
            last_progress_saved_at = 0.0

            async def update_progress(current: int, total: int) -> None:
                nonlocal last_progress_saved_at
                status.update({"current": current, "total": total, **request_quota.status_fields()})
                current_time = monotonic()
                if current < total and current_time - last_progress_saved_at < 0.5:
                    return
                last_progress_saved_at = current_time
                await _save_sync_status(status)

            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                records = await _fetch_list(client, service_key, update_progress, request_quota)
                if not records:
                    raise ValueError("복지로 API가 복지서비스 목록을 반환하지 않아 기존 데이터를 유지합니다.")
                status.update({"stage": "welfareDetail", "current": 0, "total": len(records)})
                await _save_sync_status(status)
                details = await _fetch_details(client, service_key, records, update_progress, request_quota)

            quota_exhausted = request_quota.exhausted
            await _ensure_index()
            fetched_at = _utc_now()
            documents = [_build_document(item, details.get(str(item.get("servId") or ""), {}), fetched_at) for item in records]
            documents = [
                document for document in documents
                if document["external_id"] and document["title"] and is_storable_by_deadline(document)
            ]
            status.update({"stage": "indexing", "current": 0, "total": len(documents)})
            await _save_sync_status(status)
            actions = [{"_op_type": "index", "_index": INDEX_NAME, "_id": document["external_id"], "_source": document} for document in documents]
            es = get_es()
            try:
                indexed = 0
                for offset in range(0, len(actions), BULK_CHUNK_SIZE):
                    chunk = actions[offset:offset + BULK_CHUNK_SIZE]
                    chunk_indexed, errors = await async_bulk(es, chunk, chunk_size=BULK_CHUNK_SIZE, refresh=False, raise_on_error=False)
                    if errors or chunk_indexed != len(chunk):
                        raise RuntimeError("개인 복지급여 데이터 일부를 저장하지 못했습니다.")
                    indexed += chunk_indexed
                    status.update({"current": indexed})
                    await _save_sync_status(status)
                if not quota_exhausted:
                    await es.delete_by_query(index=INDEX_NAME, query={"range": {"fetched_at": {"lt": fetched_at}}}, conflicts="proceed", refresh=False)
                await es.indices.refresh(index=INDEX_NAME)
                stored_document_count = int((await es.count(index=INDEX_NAME)).get("count", len(documents)))
            finally:
                await es.close()
            await _save_sync_status({"status": "failed" if quota_exhausted else "completed", "stage": "completed", "current": len(documents), "total": len(documents), "document_count": stored_document_count, "started_at": started_at, "completed_at": fetched_at, "last_successful_sync_at": previous.get("last_successful_sync_at") if quota_exhausted else fetched_at, "error_code": "request_limit_exceeded" if quota_exhausted else None, "partial_document_count": len(documents) if quota_exhausted else 0, **request_quota.status_fields()})
        except Exception as error:
            await _save_sync_status({
                **status,
                "status": "failed",
                "failed_at": _utc_now(),
                "error": str(error),
                "error_code": getattr(error, "error_code", "sync_failed"),
                **request_quota.status_fields(),
            })


def start_synchronization(service_key: str) -> bool:
    if _sync_lock.locked() or any(not task.done() for task in _sync_tasks):
        return False
    task = asyncio.create_task(synchronize(service_key), name="external-data-kr-welfare-sync")
    _sync_tasks.add(task)
    task.add_done_callback(_sync_tasks.discard)
    return True


async def browse_documents(query: str = "", search_after: list | None = None) -> dict:
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME):
            return {"items": [], "total": 0, "next_cursor": None}
        search_query: dict = {"term": {"lifecycle_status": "active"}}
        sort: list[dict] = [{"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": {"order": "asc"}}]
        if query.strip():
            search_query = {"bool": {"filter": [{"term": {"lifecycle_status": "active"}}], "must": [{"multi_match": {"query": query.strip(), "fields": ["title^6", "agency^2", "target^4", "category^2", "user_type^2", "content_text"], "operator": "and"}}]}}
            sort = [{"_score": {"order": "desc"}}, {"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": {"order": "asc"}}]
        request: dict = {"index": INDEX_NAME, "size": BROWSE_PAGE_SIZE, "track_total_hits": True, "query": search_query, "sort": sort}
        if search_after:
            request["search_after"] = search_after
        result = await es.search(**request)
        hits = result.get("hits", {}).get("hits", [])
        items = []
        for hit in hits:
            source = hit.get("_source", {})
            items.append({
                "id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""),
                "agency": source.get("agency", ""), "target": source.get("target", ""),
                "category": source.get("category", ""), "user_type": source.get("user_type", ""),
                "support_type": source.get("support_type", ""), "application_deadline": "",
                "application_end_date": None, "source_url": source.get("source_url", ""),
                "source_modified_at": source.get("source_modified_at", ""), "summary": source.get("summary", ""),
                "purpose": source.get("purpose", ""), "content": source.get("content", ""),
                "selection_criteria": source.get("selection_criteria", ""),
                "application_method": source.get("application_method", ""),
                "required_documents": source.get("required_documents", ""), "contact": source.get("contact", ""),
                "attachments": [],
            })
        total = result.get("hits", {}).get("total", {}).get("value", 0)
        return {"items": items, "total": total, "next_cursor": hits[-1].get("sort") if len(hits) == BROWSE_PAGE_SIZE else None}
    finally:
        await es.close()


async def search_candidates(question: str, size: int = 8) -> list[dict]:
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME) or not question.strip():
            return []
        result = await es.search(index=INDEX_NAME, size=size, query={"bool": {
            "filter": [{"term": {"lifecycle_status": "active"}}],
            "must": [{"multi_match": {"query": question.strip(), "fields": ["title^6", "target^4", "agency^3", "category^2", "user_type^2", "content_text"], "operator": "or", "minimum_should_match": "20%"}}],
        }})
        return [{
            "id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""),
            "content": source.get("content_text", "")[:1800], "url": source.get("source_url", ""),
            "source": "Bokjiro", "source_modified_at": source.get("source_modified_at", ""),
            "application_deadline": "", "application_end_date": None, "deadline_kind": "unknown",
            "score": hit.get("_score", 0), "external_resource_id": SOURCE_ID,
        } for hit in result.get("hits", {}).get("hits", []) for source in [hit.get("_source", {})]]
    finally:
        await es.close()
