"""Synchronize current public-housing recruitment notices from the MyHome API."""

import asyncio
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk

from services.db import SETTINGS_INDEX, get_es
from services.external_data.quota import DailyRequestQuota
from services.external_data.search import RERANK_CANDIDATE_SIZE, build_browser_search_query, build_candidate_search_query, select_relevant_candidates
from services.external_data.retention import is_storable_by_deadline
from services.external_data.status_events import notify_status_changed

SOURCE_ID = "kr.housing"
INDEX_NAME = "external_data_kr_housing"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_housing"
API_BASE_URL = "https://apis.data.go.kr/1613000/HWSPR02"
PAGE_SIZE = 1000
BULK_CHUNK_SIZE = 100
BROWSE_PAGE_SIZE = 40
DAILY_REQUEST_LIMIT = 1_000
LATEST_MONTH_WINDOW = 12

ENDPOINTS = {
    "housingRental": "rsdtRcritNtcList",
    "housingSale": "ltRsdtRcritNtcList",
}

_sync_tasks: set[asyncio.Task] = set()
_sync_lock = asyncio.Lock()


class HousingApiError(ValueError):
    def __init__(self, message: str, error_code: str = "api_error") -> None:
        super().__init__(message)
        self.error_code = error_code


def _utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _normalize_service_key(service_key: str) -> str:
    stripped_key = service_key.strip()
    return unquote(stripped_key) if "%" in stripped_key else stripped_key


def _month_offset(value: datetime, offset: int) -> datetime:
    month_index = value.year * 12 + value.month - 1 + offset
    return value.replace(year=month_index // 12, month=month_index % 12 + 1, day=1)


def _latest_month_range(now: datetime | None = None) -> tuple[str, str]:
    current = now or datetime.now(timezone.utc)
    return (
        _month_offset(current, -(LATEST_MONTH_WINDOW - 1)).strftime("%Y%m"),
        current.strftime("%Y%m"),
    )


def _format_date(value: object) -> str | None:
    digits = "".join(character for character in str(value or "") if character.isdigit())
    if len(digits) < 8:
        return None
    try:
        return datetime.strptime(digits[:8], "%Y%m%d").date().isoformat()
    except ValueError:
        return None


def _items_and_total(payload: dict) -> tuple[list[dict], int]:
    header = payload.get("header") or payload.get("response", {}).get("header") or {}
    result_code = str(header.get("resultCode", "00"))
    if result_code not in {"0", "00", "03"}:
        message = str(header.get("resultMsg") or "마이홈 API 호출에 실패했습니다.")
        error_code = "request_limit_exceeded" if result_code == "22" else "api_error"
        raise HousingApiError(f"{message} ({result_code})", error_code)
    body = payload.get("body") or payload.get("response", {}).get("body") or {}
    items = body.get("item", [])
    if isinstance(items, dict):
        items = [items]
    if not isinstance(items, list):
        raise HousingApiError("마이홈 API 응답에 공고 목록이 없습니다.")
    records = [item for item in items if isinstance(item, dict)]
    return records, int(body.get("totalCount") or len(records))


def _parse_api_response(response: httpx.Response) -> tuple[list[dict], int]:
    try:
        return _items_and_total(response.json())
    except ValueError as json_error:
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError:
            raise HousingApiError("마이홈 API가 올바른 JSON을 반환하지 않았습니다.") from json_error
        reason_code = (root.findtext(".//returnReasonCode") or "").strip()
        message = (
            root.findtext(".//returnAuthMsg")
            or root.findtext(".//errMsg")
            or "마이홈 API 호출에 실패했습니다."
        ).strip()
        error_code = "request_limit_exceeded" if reason_code == "22" else "api_error"
        raise HousingApiError(f"{message} ({reason_code or 'unknown'})", error_code) from json_error


async def _fetch_endpoint(
    client: httpx.AsyncClient,
    endpoint: str,
    service_key: str,
    request_quota: DailyRequestQuota,
    progress_callback,
) -> list[dict]:
    records: list[dict] = []
    page = 1
    begin_month, end_month = _latest_month_range()
    while True:
        if request_quota.exhausted:
            return records
        request_quota.consume()
        response = await client.get(
            f"{API_BASE_URL}/{endpoint}",
            params={
                "serviceKey": _normalize_service_key(service_key),
                "numOfRows": PAGE_SIZE,
                "pageNo": page,
                "yearMtBegin": begin_month,
                "yearMtEnd": end_month,
            },
        )
        response.raise_for_status()
        try:
            page_records, total = _parse_api_response(response)
        except HousingApiError as error:
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


def _money(value: object) -> str:
    try:
        amount = int(float(str(value or "0").replace(",", "")))
    except ValueError:
        return str(value or "").strip()
    return f"{amount:,}원" if amount else ""


def _build_document(item: dict, record_type: str, fetched_at: str) -> dict:
    announcement_id = str(item.get("pblancId") or "").strip()
    house_serial = str(item.get("houseSn") or "").strip()
    external_id = f"{record_type}:{announcement_id}:{house_serial}"
    title = str(item.get("pblancNm") or "").strip()
    complex_name = str(item.get("hsmpNm") or "").strip()
    region = " ".join(filter(None, [str(item.get("brtcNm") or "").strip(), str(item.get("signguNm") or "").strip()]))
    address = str(item.get("fullAdres") or "").strip()
    start_date = _format_date(item.get("beginDe"))
    end_date = _format_date(item.get("endDe"))
    announcement_date = _format_date(item.get("rcritPblancDe"))
    support_type = str(item.get("suplyTyNm") or ("공공분양" if record_type == "sale" else "공공임대")).strip()
    house_type = str(item.get("houseTyNm") or "").strip()
    status = str(item.get("sttusNm") or "").strip()
    rent_deposit = _money(item.get("rentGtn"))
    monthly_rent = _money(item.get("mtRntchrg"))
    content_parts = [
        f"단지명: {complex_name}" if complex_name else "",
        f"지역: {region}" if region else "",
        f"주소: {address}" if address else "",
        f"공급유형: {support_type}" if support_type else "",
        f"주택유형: {house_type}" if house_type else "",
        f"공고상태: {status}" if status else "",
        f"접수기간: {start_date or ''} ~ {end_date or ''}" if start_date or end_date else "",
        f"임대보증금: {rent_deposit}" if rent_deposit else "",
        f"월임대료: {monthly_rent}" if monthly_rent else "",
        f"총 공급호수: {item.get('sumSuplyCo')}" if item.get("sumSuplyCo") not in (None, "") else "",
        str(item.get("refrnc") or "").strip(),
    ]
    source_url = str(item.get("pcUrl") or item.get("url") or item.get("mobileUrl") or "").strip()
    return {
        "source_id": SOURCE_ID,
        "external_id": external_id,
        "record_type": record_type,
        "lifecycle_status": "active",
        "title": title,
        "content_text": "\n".join(part for part in content_parts if part),
        "agency": str(item.get("suplyInsttNm") or "").strip(),
        "target": region,
        "category": house_type,
        "user_type": "",
        "support_type": support_type,
        "summary": " · ".join(filter(None, [complex_name, region, support_type, status])),
        "purpose": "",
        "content": "\n".join(part for part in content_parts if part),
        "selection_criteria": "",
        "application_method": source_url,
        "required_documents": "",
        "contact": "",
        "application_deadline": " ~ ".join(filter(None, [start_date, end_date])),
        "application_end_date": end_date,
        "deadline_kind": "dated" if end_date else "unknown",
        "source_url": source_url,
        "source_modified_at": announcement_date or start_date or "",
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
            "agency": {"type": "keyword"}, "target": {"type": "text"},
            "category": {"type": "keyword"}, "user_type": {"type": "text"},
            "support_type": {"type": "keyword"}, "summary": {"type": "text"},
            "purpose": {"type": "text"}, "content": {"type": "text"},
            "selection_criteria": {"type": "text"}, "application_method": {"type": "text"},
            "required_documents": {"type": "text"}, "contact": {"type": "text"},
            "application_deadline": {"type": "text"},
            "application_end_date": {"type": "date", "format": "strict_date"},
            "deadline_kind": {"type": "keyword"}, "source_url": {"type": "keyword", "index": False},
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
        status = {"status": "running", "stage": "housingRental", "current": 0, "total": 0, "started_at": started_at, "document_count": previous.get("document_count", 0), "last_successful_sync_at": previous.get("last_successful_sync_at"), **request_quota.status_fields()}
        await _save_sync_status(status)
        try:
            datasets: dict[str, list[dict]] = {stage: [] for stage in ENDPOINTS}
            async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
                for stage, endpoint in ENDPOINTS.items():
                    if request_quota.exhausted:
                        break
                    status.update({"stage": stage, "current": 0, "total": 0})
                    await _save_sync_status(status)

                    async def update_progress(current: int, total: int) -> None:
                        status.update({"current": current, "total": total, **request_quota.status_fields()})
                        await _save_sync_status(status)

                    datasets[stage] = await _fetch_endpoint(client, endpoint, service_key, request_quota, update_progress)

            quota_exhausted = request_quota.exhausted
            if not any(datasets.values()):
                raise HousingApiError("마이홈 API가 최신 공공주택 모집공고를 반환하지 않아 기존 데이터를 유지합니다.")

            fetched_at = _utc_now()
            documents = [
                *(_build_document(item, "rental", fetched_at) for item in datasets["housingRental"]),
                *(_build_document(item, "sale", fetched_at) for item in datasets["housingSale"]),
            ]
            documents = [
                document for document in documents
                if document["external_id"] and document["title"] and is_storable_by_deadline(document)
            ]
            status.update({"stage": "indexing", "current": 0, "total": len(documents)})
            await _save_sync_status(status)
            await _ensure_index()
            actions = [{"_op_type": "index", "_index": INDEX_NAME, "_id": document["external_id"], "_source": document} for document in documents]
            es = get_es()
            try:
                indexed = 0
                for offset in range(0, len(actions), BULK_CHUNK_SIZE):
                    chunk = actions[offset:offset + BULK_CHUNK_SIZE]
                    chunk_indexed, errors = await async_bulk(es, chunk, chunk_size=BULK_CHUNK_SIZE, refresh=False, raise_on_error=False)
                    if errors or chunk_indexed != len(chunk):
                        raise RuntimeError("공공주택 모집공고 일부를 저장하지 못했습니다.")
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
            await _save_sync_status({**status, "status": "failed", "failed_at": _utc_now(), "error": getattr(error, "error_code", "sync_failed"), "error_code": getattr(error, "error_code", "sync_failed"), **request_quota.status_fields()})


def start_synchronization(service_key: str) -> bool:
    if _sync_lock.locked() or any(not task.done() for task in _sync_tasks):
        return False
    task = asyncio.create_task(synchronize(service_key), name="external-data-kr-housing-sync")
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
            search_query = build_browser_search_query(query, filters=[{"term": {"lifecycle_status": "active"}}])
            sort = [{"_score": {"order": "desc"}}, {"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": {"order": "asc"}}]
        request: dict = {"index": INDEX_NAME, "size": BROWSE_PAGE_SIZE, "track_total_hits": True, "query": search_query, "sort": sort}
        if search_after:
            request["search_after"] = search_after
        result = await es.search(**request)
        hits = result.get("hits", {}).get("hits", [])
        items = []
        for hit in hits:
            source = hit.get("_source", {})
            items.append({"id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""), "agency": source.get("agency", ""), "target": source.get("target", ""), "category": source.get("category", ""), "user_type": source.get("user_type", ""), "support_type": source.get("support_type", ""), "application_deadline": source.get("application_deadline", ""), "application_end_date": source.get("application_end_date"), "record_type": source.get("record_type", ""), "source_url": source.get("source_url", ""), "source_modified_at": source.get("source_modified_at", ""), "summary": source.get("summary", ""), "purpose": source.get("purpose", ""), "content": source.get("content", ""), "selection_criteria": source.get("selection_criteria", ""), "application_method": source.get("application_method", ""), "required_documents": source.get("required_documents", ""), "contact": source.get("contact", ""), "attachments": []})
        total = result.get("hits", {}).get("total", {}).get("value", 0)
        return {"items": items, "total": total, "next_cursor": hits[-1].get("sort") if len(hits) == BROWSE_PAGE_SIZE else None}
    finally:
        await es.close()


async def search_candidates(question: str, size: int = 8) -> list[dict]:
    es = get_es()
    try:
        if not await es.indices.exists(index=INDEX_NAME) or not question.strip():
            return []
        today = datetime.now(timezone.utc).date().isoformat()
        filters = [{"term": {"lifecycle_status": "active"}}, {"bool": {"should": [{"bool": {"must_not": {"exists": {"field": "application_end_date"}}}}, {"range": {"application_end_date": {"gte": today}}}], "minimum_should_match": 1}}]
        result = await es.search(index=INDEX_NAME, size=RERANK_CANDIDATE_SIZE, query=build_candidate_search_query(
            question, ["title^6", "target^4", "agency^3", "category^2", "support_type^3", "content_text"], filters,
        ))
        candidates = [{"id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""), "content": source.get("content_text", "")[:1800], "url": source.get("source_url", ""), "source": "MyHome", "source_modified_at": source.get("source_modified_at", ""), "application_deadline": source.get("application_deadline", ""), "application_end_date": source.get("application_end_date"), "deadline_kind": source.get("deadline_kind", "unknown"), "score": hit.get("_score", 0), "external_resource_id": SOURCE_ID} for hit in result.get("hits", {}).get("hits", []) for source in [hit.get("_source", {})]]
        return await select_relevant_candidates(question, candidates, size)
    finally:
        await es.close()
