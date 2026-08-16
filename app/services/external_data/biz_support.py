"""Synchronize SME support announcements from the BizInfo public API."""

import asyncio
import html
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk

from services.db import SETTINGS_INDEX, get_es
from services.external_data.gov24 import normalize_application_deadline
from services.external_data.quota import DailyRequestQuota
from services.external_data.search import RERANK_CANDIDATE_SIZE, build_browser_search_query, build_candidate_search_query, select_relevant_candidates
from services.external_data.retention import is_storable_by_deadline
from services.external_data.status_events import notify_status_changed

SOURCE_ID = "kr.biz_support"
INDEX_NAME = "external_data_kr_biz_support"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_biz_support"
API_URL = "https://apis.data.go.kr/1421000/bizinfo/pblancBsnsService"
PAGE_SIZE = 100
BULK_CHUNK_SIZE = 100
BROWSE_PAGE_SIZE = 40
DAILY_REQUEST_LIMIT = 10_000

_sync_tasks: set[asyncio.Task] = set()
_sync_lock = asyncio.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _value(item: dict, *keys: str) -> str:
    for key in keys:
        value = item.get(key)
        if value not in (None, ""):
            return str(value).strip()
    return ""


def _items_and_total(payload: dict) -> tuple[list[dict], int]:
    response = payload.get("response", payload)
    header = response.get("header") or {}
    result_code = str(header.get("resultCode", "00"))
    if result_code not in {"0", "00", "0000"}:
        raise ValueError(header.get("resultMsg") or "기업마당 API 호출에 실패했습니다.")
    body = response.get("body", response)
    items = body.get("items", [])
    if isinstance(items, dict):
        items = items.get("item", items.get("items", []))
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise ValueError("기업마당 API 응답에 공고 목록이 없습니다.")
    records = [item for item in items if isinstance(item, dict)]
    return records, int(body.get("totalCount") or body.get("total_count") or len(records))


def _xml_items_and_total(content: str) -> tuple[list[dict], int]:
    root = ET.fromstring(content)
    result_code = (root.findtext("./header/resultCode") or "00").strip()
    if result_code not in {"0", "00", "0000"}:
        message = (root.findtext("./header/resultMsg") or "기업마당 API 호출에 실패했습니다.").strip()
        raise ValueError(message)
    records = []
    for element in root.findall("./body/items/item"):
        records.append({child.tag: (child.text or "").strip() for child in element})
    total_text = root.findtext("./body/totalCount") or str(len(records))
    return records, int(total_text)


def _parse_api_response(response: httpx.Response) -> tuple[list[dict], int]:
    content_type = response.headers.get("content-type", "").lower()
    body = response.text.lstrip()
    if "json" in content_type or body.startswith("{"):
        payload = response.json()
        error = payload.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader", {})
        if error:
            raise ValueError(error.get("returnAuthMsg") or error.get("errMsg") or "기업마당 API 인증에 실패했습니다.")
        return _items_and_total(payload)
    if "xml" in content_type or body.startswith("<"):
        return _xml_items_and_total(body)
    response.raise_for_status()
    raise ValueError(f"지원하지 않는 기업마당 API 응답 형식입니다: {content_type or 'unknown'}")


def _plain_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _attachment_list(item: dict) -> list[dict[str, str]]:
    attachments: list[dict[str, str]] = []
    for name_key, url_key in (("printFileNm", "printFlpthNm"), ("fileNm", "flpthNm")):
        names = [value.strip() for value in _value(item, name_key).split("@") if value.strip()]
        urls = [value.strip() for value in _value(item, url_key).split("@") if value.strip()]
        for index, url in enumerate(urls):
            attachments.append({
                "name": names[index] if index < len(names) else url,
                "url": url,
            })
    return attachments


async def _fetch_announcements(service_key: str, progress_callback, request_quota: DailyRequestQuota) -> list[dict]:
    records: list[dict] = []
    page = 1
    normalized_key = unquote(service_key.strip()) if "%" in service_key else service_key.strip()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        while True:
            if request_quota.exhausted:
                return records
            request_quota.consume()
            response = await client.get(API_URL, params={
                "serviceKey": normalized_key,
                "pageNo": page,
                "numOfRows": PAGE_SIZE,
                "type": "json",
            })
            page_records, total = _parse_api_response(response)
            response.raise_for_status()
            records.extend(page_records)
            await progress_callback(len(records), total)
            if not page_records or len(records) >= total:
                break
            page += 1
    return records


def _build_document(item: dict, fetched_at: str) -> dict:
    external_id = _value(item, "pblancId", "공고ID", "announcementId", "id")
    title = _value(item, "pblancNm", "공고명", "title")
    agency = _value(item, "jrsdInsttNm", "소관명", "excInsttNm", "수행기관명")
    executing_agency = _value(item, "excInsttNm", "수행기관명")
    summary = _plain_text(_value(item, "bsnsSumryCn", "사업개요내용", "사업개요"))
    category = _value(item, "pldirSportRealmLclasCodeNm", "sprtFldNm", "지원분야대분류명", "분야")
    target = _value(item, "trgetNm", "sprtTrgetNm", "지원대상")
    application_deadline = _value(item, "reqstBeginEndDe", "신청기간")
    application_method = _value(item, "reqstMthPapersCn", "bsnsReqstMthdCn", "사업신청방법내용", "신청방법")
    contact = _value(item, "refrncNm", "inqireTelNo", "문의처")
    hashtags = _value(item, "hashtags", "hashtag", "해시태그")
    source_url = _value(item, "pblancUrl", "공고URL", "rceptEngnHmpgUrl", "bsnsReqstUrl", "사업신청URL")
    application_url = _value(item, "rceptEngnHmpgUrl", "bsnsReqstUrl", "사업신청URL")
    created_at = _value(item, "creatPnttm", "등록일자", "createdAt")
    view_count = _value(item, "inqireCo", "조회수", "viewCount")
    attachments = _attachment_list(item)
    modified_at = _value(
        item,
        "updtPnttm",
        "lastUpdtPnttm",
        "수정일자",
        "수정일",
        "modifiedAt",
    )
    deadline_kind, application_end_date = normalize_application_deadline(application_deadline)
    sections = [
        ("공고명", title), ("소관기관", agency), ("수행기관", executing_agency),
        ("사업개요", summary), ("분야", category), ("지원대상", target),
        ("신청기간", application_deadline), ("신청방법", application_method),
        ("문의처", contact), ("해시태그", hashtags),
        ("첨부파일", "\n".join(attachment["name"] for attachment in attachments)),
    ]
    return {
        "source_id": SOURCE_ID,
        "external_id": external_id,
        "lifecycle_status": "active",
        "title": title,
        "content_text": "\n\n".join(f"{label}\n{value}" for label, value in sections if value),
        "agency": agency,
        "executing_agency": executing_agency,
        "category": category,
        "target": target,
        "application_deadline": application_deadline,
        "application_end_date": application_end_date,
        "deadline_kind": deadline_kind,
        "application_method": application_method,
        "contact": contact,
        "hashtags": hashtags,
        "source_url": source_url,
        "application_url": application_url,
        "created_at": created_at,
        "view_count": int(view_count) if view_count.isdigit() else None,
        "attachments": attachments,
        "source_modified_at": modified_at,
        "fetched_at": fetched_at,
        "raw": item,
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
            "executing_agency": {"type": "keyword"}, "category": {"type": "keyword"},
            "target": {"type": "text"}, "application_deadline": {"type": "text"},
            "application_end_date": {"type": "date", "format": "strict_date"},
            "deadline_kind": {"type": "keyword"}, "application_method": {"type": "text"},
            "contact": {"type": "text"}, "hashtags": {"type": "text"},
            "source_url": {"type": "keyword", "index": False},
            "application_url": {"type": "keyword", "index": False},
            "created_at": {"type": "keyword"}, "view_count": {"type": "integer"},
            "attachments": {"type": "object", "enabled": False},
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
        status = {"status": "running", "stage": "list", "current": 0, "total": 0, "started_at": started_at, "document_count": previous.get("document_count", 0), "last_successful_sync_at": previous.get("last_successful_sync_at"), **request_quota.status_fields()}
        await _save_sync_status(status)
        try:
            async def update_progress(current: int, total: int) -> None:
                status.update({"current": current, "total": total, **request_quota.status_fields()})
                await _save_sync_status(status)

            records = await _fetch_announcements(service_key, update_progress, request_quota)
            quota_exhausted = request_quota.exhausted
            if not records:
                raise ValueError("기업마당 API가 공고를 반환하지 않아 기존 데이터를 유지합니다.")
            await _ensure_index()
            fetched_at = _utc_now()
            documents = []
            for item in records:
                document = _build_document(item, fetched_at)
                if not document["external_id"] or not document["title"] or not is_storable_by_deadline(document):
                    continue
                documents.append({"_op_type": "index", "_index": INDEX_NAME, "_id": document["external_id"], "_source": document})
            status.update({"stage": "indexing", "current": 0, "total": len(documents)})
            await _save_sync_status(status)
            es = get_es()
            try:
                if documents:
                    indexed, errors = await async_bulk(es, documents, chunk_size=BULK_CHUNK_SIZE, refresh=False, raise_on_error=False)
                    if errors or indexed != len(documents):
                        raise RuntimeError("기업마당 데이터 일부를 저장하지 못했습니다.")
                    status["current"] = indexed
                    await _save_sync_status(status)
                if not quota_exhausted:
                    await es.delete_by_query(
                        index=INDEX_NAME,
                        query={"range": {"fetched_at": {"lt": fetched_at}}},
                        conflicts="proceed",
                        refresh=False,
                    )
                await es.indices.refresh(index=INDEX_NAME)
                stored_document_count = int((await es.count(index=INDEX_NAME)).get("count", len(documents)))
            finally:
                await es.close()
            await _save_sync_status({"status": "failed" if quota_exhausted else "completed", "stage": "completed", "current": len(documents), "total": len(documents), "document_count": stored_document_count, "started_at": started_at, "completed_at": fetched_at, "last_successful_sync_at": previous.get("last_successful_sync_at") if quota_exhausted else fetched_at, "error_code": "request_limit_exceeded" if quota_exhausted else None, "partial_document_count": len(documents) if quota_exhausted else 0, **request_quota.status_fields()})
        except Exception as error:
            await _save_sync_status({**status, "status": "failed", "failed_at": _utc_now(), "error": getattr(error, "error_code", "sync_failed"), "error_code": getattr(error, "error_code", "sync_failed"), **request_quota.status_fields()})


def start_synchronization(service_key: str) -> bool:
    if _sync_lock.locked() or any(not task.done() for task in _sync_tasks):
        return False
    task = asyncio.create_task(synchronize(service_key), name="external-data-kr-biz-support-sync")
    _sync_tasks.add(task)
    task.add_done_callback(_sync_tasks.discard)
    return True


async def browse_documents(query: str = "", search_after: list | None = None) -> dict:
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME):
            return {"items": [], "total": 0, "next_cursor": None}
        search_query: dict = {"match_all": {}}
        sort: list[dict | str] = [
            {"source_modified_at": {"order": "desc", "missing": "_last"}},
            {"external_id": "asc"},
        ]
        if query.strip():
            search_query = build_browser_search_query(query)
            sort = [
                {"_score": "desc"},
                {"source_modified_at": {"order": "desc", "missing": "_last"}},
                {"external_id": "asc"},
            ]
        request: dict = {"index": INDEX_NAME, "size": BROWSE_PAGE_SIZE, "track_total_hits": True, "query": search_query, "sort": sort}
        if search_after:
            request["search_after"] = search_after
        result = await es.search(**request)
        hits = result.get("hits", {}).get("hits", [])
        items = []
        for hit in hits:
            source = hit.get("_source", {})
            items.append({"id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""), "agency": source.get("agency", ""), "target": source.get("target", ""), "category": source.get("category", ""), "application_deadline": source.get("application_deadline", ""), "application_end_date": source.get("application_end_date"), "source_url": source.get("source_url", ""), "application_url": source.get("application_url", ""), "source_modified_at": source.get("source_modified_at", ""), "created_at": source.get("created_at", ""), "view_count": source.get("view_count"), "attachments": source.get("attachments", []), "summary": _plain_text(source.get("raw", {}).get("bsnsSumryCn", "")), "content": source.get("content_text", ""), "application_method": source.get("application_method", ""), "contact": source.get("contact", "")})
        total = result.get("hits", {}).get("total", {}).get("value", 0)
        return {"items": items, "total": total, "next_cursor": hits[-1].get("sort") if len(hits) == BROWSE_PAGE_SIZE else None}
    finally:
        await es.close()


async def search_candidates(question: str, size: int = 8) -> list[dict]:
    """Return currently relevant BizInfo announcements for chat grounding."""
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME) or not question.strip():
            return []
        filters = [{"bool": {"should": [
                {"bool": {"must_not": {"exists": {"field": "application_end_date"}}}},
                {"range": {"application_end_date": {"gte": datetime.now().date().isoformat()}}},
            ], "minimum_should_match": 1}}]
        result = await es.search(index=INDEX_NAME, size=RERANK_CANDIDATE_SIZE, query=build_candidate_search_query(
            question, ["title^6", "target^4", "agency^3", "category^2", "hashtags^2", "content_text"], filters,
        ))
        candidates = []
        for hit in result.get("hits", {}).get("hits", []):
            source = hit.get("_source", {})
            candidates.append({
                "id": source.get("external_id", hit.get("_id", "")),
                "title": source.get("title", ""),
                "content": source.get("content_text", "")[:1800],
                "url": source.get("source_url", ""),
                "source": "BizInfo",
                "source_modified_at": source.get("source_modified_at", ""),
                "application_deadline": source.get("application_deadline", ""),
                "application_end_date": source.get("application_end_date"),
                "deadline_kind": source.get("deadline_kind", "unknown"),
                "score": hit.get("_score", 0),
                "external_resource_id": SOURCE_ID,
            })
        return await select_relevant_candidates(question, candidates, size)
    finally:
        await es.close()
