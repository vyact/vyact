"""Synchronize startup support programs from the K-Startup public API."""

import asyncio
import html
import math
import re
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk

from services.db import SETTINGS_INDEX, get_es
from services.external_data.gov24 import normalize_application_deadline

SOURCE_ID = "kr.k_startup"
INDEX_NAME = "external_data_kr_k_startup"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_k_startup"
API_BASE_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01"
ANNOUNCEMENTS_ENDPOINT = "getAnnouncementInformation01"
BUSINESSES_ENDPOINT = "getBusinessInformation01"
PAGE_SIZE = 1000
BULK_CHUNK_SIZE = 100
BROWSE_PAGE_SIZE = 40

_sync_tasks: set[asyncio.Task] = set()
_sync_lock = asyncio.Lock()


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _value(item: dict, key: str) -> str:
    value = item.get(key)
    return "" if value in (None, "") else html.unescape(str(value)).strip()


def _plain_text(value: str) -> str:
    without_tags = re.sub(r"<[^>]+>", " ", value or "")
    return re.sub(r"\s+", " ", html.unescape(without_tags)).strip()


def _format_date(value: str) -> str:
    digits = re.sub(r"\D", "", value or "")
    if len(digits) >= 8:
        return f"{digits[:4]}.{digits[4:6]}.{digits[6:8]}"
    return value.strip()


def _items_and_total(payload: dict) -> tuple[list[dict], int]:
    error = payload.get("OpenAPI_ServiceResponse", {}).get("cmmMsgHeader", {})
    if error:
        raise ValueError(error.get("returnAuthMsg") or error.get("errMsg") or "K-Startup API 인증에 실패했습니다.")
    data = payload.get("data", {})
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        items = data.get("data", [])
    else:
        items = []
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise ValueError("K-Startup API 응답에 데이터 목록이 없습니다.")
    records = [item for item in items if isinstance(item, dict)]
    total = payload.get("totalCount", payload.get("matchCount", len(records)))
    return records, int(total or 0)


async def _fetch_endpoint(service_key: str, endpoint: str, stage: str, progress_callback) -> list[dict]:
    records: list[dict] = []
    page = 1
    total = 0
    normalized_key = unquote(service_key.strip()) if "%" in service_key else service_key.strip()
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        while True:
            response = await client.get(
                f"{API_BASE_URL}/{endpoint}",
                params={
                    "serviceKey": normalized_key,
                    "page": page,
                    "perPage": PAGE_SIZE,
                    "returnType": "json",
                },
            )
            response.raise_for_status()
            try:
                payload = response.json()
            except ValueError as error:
                raise ValueError("K-Startup API가 JSON이 아닌 응답을 반환했습니다.") from error
            page_records, total = _items_and_total(payload)
            records.extend(page_records)
            await progress_callback(stage, len(records), total)
            if not page_records or len(records) >= total or page >= math.ceil(total / PAGE_SIZE):
                break
            page += 1
    return records


def _announcement_document(item: dict, fetched_at: str) -> dict:
    external_id = _value(item, "pbanc_sn")
    title = _value(item, "biz_pbanc_nm") or _value(item, "intg_pbanc_biz_nm")
    start_date = _format_date(_value(item, "pbanc_rcpt_bgng_dt"))
    end_date = _format_date(_value(item, "pbanc_rcpt_end_dt"))
    application_deadline = " ~ ".join(value for value in (start_date, end_date) if value)
    deadline_kind, application_end_date = normalize_application_deadline(application_deadline)
    application_methods = [
        _value(item, "aply_mthd_onli_rcpt_istc"),
        _value(item, "aply_mthd_eml_rcpt_istc"),
        _value(item, "aply_mthd_vst_rcpt_istc"),
        _value(item, "aply_mthd_pssr_rcpt_istc"),
        _value(item, "aply_mthd_fax_rcpt_istc"),
        _value(item, "aply_mthd_etc_istc"),
    ]
    target_parts = [
        _value(item, "aply_trgt_ctnt"),
        _value(item, "aply_trgt"),
        _value(item, "biz_enyy"),
        _value(item, "biz_trgt_age"),
    ]
    agency = _value(item, "sprv_inst") or _value(item, "pbanc_ntrp_nm")
    contact_parts = [_value(item, "biz_prch_dprt_nm"), _value(item, "prch_cnpl_no")]
    content = _plain_text(_value(item, "pbanc_ctnt"))
    target = " · ".join(dict.fromkeys(value for value in target_parts if value))
    application_method = "\n".join(dict.fromkeys(value for value in application_methods if value))
    contact = " · ".join(value for value in contact_parts if value)
    sections = [
        ("공고명", title), ("주관기관", agency), ("지원분야", _value(item, "supt_biz_clsfc")),
        ("지원지역", _value(item, "supt_regin")), ("지원대상", target),
        ("접수기간", application_deadline), ("공고내용", content),
        ("신청방법", application_method), ("신청제외대상", _value(item, "aply_excl_trgt_ctnt")),
        ("우대사항", _value(item, "prfn_matr")), ("문의처", contact),
    ]
    return {
        "source_id": SOURCE_ID,
        "external_id": f"announcement:{external_id}",
        "record_type": "announcement",
        "lifecycle_status": "active",
        "title": title,
        "content_text": "\n\n".join(f"{label}\n{value}" for label, value in sections if value),
        "agency": agency,
        "category": _value(item, "supt_biz_clsfc"),
        "target": target,
        "summary": content,
        "application_deadline": application_deadline,
        "application_end_date": application_end_date,
        "deadline_kind": deadline_kind,
        "application_method": application_method,
        "contact": contact,
        "source_url": _value(item, "detl_pg_url") or _value(item, "biz_gdnc_url"),
        "application_url": _value(item, "biz_aply_url"),
        "source_modified_at": end_date or start_date,
        "fetched_at": fetched_at,
        "raw": item,
    }


def _business_document(item: dict, fetched_at: str) -> dict:
    title = _value(item, "supt_biz_titl_nm")
    year = _value(item, "biz_yr")
    source_url = _value(item, "detl_pg_url")
    stable_key = source_url or f"{year}:{title}"
    external_id = re.sub(r"[^0-9A-Za-z가-힣._:-]+", "-", stable_key).strip("-")
    target = _plain_text(_value(item, "biz_supt_trgt_info"))
    content = _plain_text(_value(item, "biz_supt_ctnt"))
    summary = _plain_text(_value(item, "supt_biz_intrd_info"))
    sections = [
        ("사업명", title), ("사업연도", year), ("지원대상", target),
        ("지원예산 및 규모", _plain_text(_value(item, "biz_supt_bdgt_info"))),
        ("지원내용", content), ("지원특징", _plain_text(_value(item, "supt_biz_chrct"))),
        ("사업소개", summary),
    ]
    return {
        "source_id": SOURCE_ID,
        "external_id": f"business:{external_id}",
        "record_type": "business",
        "lifecycle_status": "active",
        "title": title,
        "content_text": "\n\n".join(f"{label}\n{value}" for label, value in sections if value),
        "agency": "창업진흥원",
        "category": _value(item, "biz_category_cd"),
        "target": target,
        "summary": summary,
        "application_deadline": "",
        "application_end_date": None,
        "deadline_kind": "unknown",
        "application_method": "",
        "contact": "",
        "source_url": source_url,
        "application_url": "",
        "source_modified_at": year,
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
            "record_type": {"type": "keyword"}, "lifecycle_status": {"type": "keyword"},
            "title": {"type": "text"}, "content_text": {"type": "text"},
            "agency": {"type": "keyword"}, "category": {"type": "keyword"},
            "target": {"type": "text"}, "summary": {"type": "text"},
            "application_deadline": {"type": "text"},
            "application_end_date": {"type": "date", "format": "strict_date"},
            "deadline_kind": {"type": "keyword"}, "application_method": {"type": "text"},
            "contact": {"type": "text"}, "source_url": {"type": "keyword", "index": False},
            "application_url": {"type": "keyword", "index": False},
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


async def get_sync_status() -> dict:
    es = get_es()
    try:
        result = await es.get(index=SETTINGS_INDEX, id=SYNC_STATUS_DOC_ID, ignore=[404])
        if not result.get("found"):
            return {"status": "idle", "document_count": 0}
        value = result["_source"].get("value", {})
        return value if isinstance(value, dict) else {"status": "idle", "document_count": 0}
    finally:
        await es.close()


async def synchronize(service_key: str) -> None:
    async with _sync_lock:
        started_at = _utc_now()
        previous = await get_sync_status()
        status = {
            "status": "running", "stage": "startupAnnouncements", "current": 0, "total": 0,
            "started_at": started_at, "document_count": previous.get("document_count", 0),
            "last_successful_sync_at": previous.get("last_successful_sync_at"),
        }
        await _save_sync_status(status)
        try:
            async def update_progress(stage: str, current: int, total: int) -> None:
                status.update({"stage": stage, "current": current, "total": total})
                await _save_sync_status(status)

            announcements = await _fetch_endpoint(service_key, ANNOUNCEMENTS_ENDPOINT, "startupAnnouncements", update_progress)
            businesses = await _fetch_endpoint(service_key, BUSINESSES_ENDPOINT, "startupBusinesses", update_progress)
            if not announcements and not businesses:
                raise ValueError("K-Startup API가 지원사업 데이터를 반환하지 않아 기존 데이터를 유지합니다.")
            await _ensure_index()
            fetched_at = _utc_now()
            documents = [
                *(_announcement_document(item, fetched_at) for item in announcements),
                *(_business_document(item, fetched_at) for item in businesses),
            ]
            documents = [document for document in documents if document["external_id"] and document["title"]]
            status.update({"stage": "indexing", "current": 0, "total": len(documents)})
            await _save_sync_status(status)
            actions = [
                {"_op_type": "index", "_index": INDEX_NAME, "_id": document["external_id"], "_source": document}
                for document in documents
            ]
            es = get_es()
            try:
                indexed = 0
                for offset in range(0, len(actions), BULK_CHUNK_SIZE):
                    chunk = actions[offset:offset + BULK_CHUNK_SIZE]
                    chunk_indexed, errors = await async_bulk(es, chunk, chunk_size=BULK_CHUNK_SIZE, refresh=False, raise_on_error=False)
                    if errors or chunk_indexed != len(chunk):
                        raise RuntimeError("K-Startup 데이터 일부를 저장하지 못했습니다.")
                    indexed += chunk_indexed
                    status.update({"current": indexed})
                    await _save_sync_status(status)
                await es.delete_by_query(index=INDEX_NAME, query={"range": {"fetched_at": {"lt": fetched_at}}}, conflicts="proceed", refresh=False)
                await es.indices.refresh(index=INDEX_NAME)
            finally:
                await es.close()
            await _save_sync_status({
                "status": "completed", "stage": "completed", "current": len(documents), "total": len(documents),
                "document_count": len(documents), "started_at": started_at, "completed_at": fetched_at,
                "last_successful_sync_at": fetched_at,
            })
        except Exception as error:
            await _save_sync_status({**status, "status": "failed", "failed_at": _utc_now(), "error": str(error)})


def start_synchronization(service_key: str) -> bool:
    if _sync_lock.locked() or any(not task.done() for task in _sync_tasks):
        return False
    task = asyncio.create_task(synchronize(service_key), name="external-data-kr-k-startup-sync")
    _sync_tasks.add(task)
    task.add_done_callback(_sync_tasks.discard)
    return True


async def browse_documents(query: str = "", search_after: list | None = None) -> dict:
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME):
            return {"items": [], "total": 0, "next_cursor": None}
        search_query: dict = {"match_all": {}}
        sort: list[dict | str] = [{"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": "asc"}]
        if query.strip():
            search_query = {"multi_match": {"query": query.strip(), "fields": ["title^6", "agency^2", "target^3", "category^2", "summary^2", "content_text"], "operator": "and"}}
            sort = [{"_score": "desc"}, {"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": "asc"}]
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
                "category": source.get("category", ""), "application_deadline": source.get("application_deadline", ""),
                "source_url": source.get("source_url", ""), "application_url": source.get("application_url", ""),
                "source_modified_at": source.get("source_modified_at", ""), "summary": source.get("summary", ""),
                "content": source.get("content_text", ""), "application_method": source.get("application_method", ""),
                "contact": source.get("contact", ""), "attachments": [],
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
            "filter": [{"term": {"lifecycle_status": "active"}}, {"bool": {"should": [
                {"bool": {"must_not": {"exists": {"field": "application_end_date"}}}},
                {"range": {"application_end_date": {"gte": datetime.now().date().isoformat()}}},
            ], "minimum_should_match": 1}}],
            "must": [{"multi_match": {"query": question.strip(), "fields": ["title^6", "target^4", "agency^3", "category^2", "summary^2", "content_text"], "operator": "or", "minimum_should_match": "20%"}}],
        }})
        return [{
            "id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""),
            "content": source.get("content_text", "")[:1800], "url": source.get("source_url", ""),
            "source": "K-Startup", "source_modified_at": source.get("source_modified_at", ""),
            "application_deadline": source.get("application_deadline", ""),
            "application_end_date": source.get("application_end_date"),
            "deadline_kind": source.get("deadline_kind", "unknown"), "score": hit.get("_score", 0),
            "external_resource_id": SOURCE_ID,
        } for hit in result.get("hits", {}).get("hits", []) for source in [hit.get("_source", {})]]
    finally:
        await es.close()
