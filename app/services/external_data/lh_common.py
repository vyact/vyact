"""Shared collector and Elasticsearch access for LH public-data APIs."""

import asyncio
import hashlib
import xml.etree.ElementTree as ET
from datetime import datetime, timezone
from urllib.parse import unquote

import httpx
from elasticsearch.helpers import async_bulk

from services.db import SETTINGS_INDEX, get_es
from services.external_data.quota import DailyRequestQuota
from services.external_data.retention import is_storable_by_deadline
from services.external_data.status_events import notify_status_changed

PAGE_SIZE = 1000
BULK_CHUNK_SIZE = 100
BROWSE_PAGE_SIZE = 40
DAILY_REQUEST_LIMIT = 10_000


class LhApiError(ValueError):
    def __init__(self, message: str, error_code: str = "api_error") -> None:
        super().__init__(message)
        self.error_code = error_code


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def stable_id(*values: object) -> str:
    joined = "|".join(str(value or "").strip() for value in values)
    return hashlib.sha256(joined.encode("utf-8")).hexdigest()


def format_money(value: object) -> str:
    raw = str(value or "").replace(",", "").strip()
    try:
        amount = int(float(raw))
    except ValueError:
        return str(value or "").strip()
    return f"{amount:,}원" if amount else ""


def parse_rows(payload: object) -> tuple[list[dict], int]:
    containers = payload if isinstance(payload, list) else [payload]
    total_hint = 0
    for container in containers:
        if not isinstance(container, dict):
            continue
        for value in container.values():
            candidates = value if isinstance(value, list) else [value]
            for candidate in candidates:
                if isinstance(candidate, dict) and candidate.get("ALL_CNT") not in (None, ""):
                    try:
                        total_hint = max(total_hint, int(candidate["ALL_CNT"]))
                    except (TypeError, ValueError):
                        pass
    for container in containers:
        if not isinstance(container, dict):
            continue
        code = str(container.get("SS_CODE") or container.get("resultCode") or "").strip()
        if code and code not in {"0", "00", "000"}:
            raise LhApiError(str(container.get("SS_MESSAGE") or container.get("resultMsg") or code))
        for key in ("dsList", "list", "items", "item", "data"):
            value = container.get(key)
            if isinstance(value, dict):
                value = [value]
            if isinstance(value, list):
                rows = [row for row in value if isinstance(row, dict)]
                total = int((rows[0].get("ALL_CNT") if rows else 0) or total_hint or 0)
                return rows, total
        nested = container.get("response") or container.get("body")
        if nested is not None:
            return parse_rows(nested)
    return [], 0


def parse_response(response: httpx.Response) -> tuple[list[dict], int]:
    try:
        payload = response.json()
    except (ValueError, TypeError) as json_error:
        try:
            root = ET.fromstring(response.text)
        except ET.ParseError:
            raise LhApiError("LH API가 올바른 JSON을 반환하지 않았습니다.") from json_error
        reason_code = (root.findtext(".//returnReasonCode") or "").strip()
        message = (root.findtext(".//returnAuthMsg") or root.findtext(".//errMsg") or "LH API 호출에 실패했습니다.").strip()
        raise LhApiError(f"{message} ({reason_code or 'unknown'})", "request_limit_exceeded" if reason_code == "22" else "api_error") from json_error
    return parse_rows(payload)


async def fetch_all(url: str, service_key: str, params: dict, quota: DailyRequestQuota, progress_callback) -> tuple[list[dict], bool]:
    rows: list[dict] = []
    page = 1
    async with httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0)) as client:
        while not quota.exhausted:
            quota.consume()
            response = await client.get(url, params={"ServiceKey": unquote(service_key.strip()), "PG_SZ": PAGE_SIZE, "PAGE": page, **params})
            response.raise_for_status()
            try:
                page_rows, total = parse_response(response)
            except LhApiError as error:
                if error.error_code != "request_limit_exceeded":
                    raise
                quota.used = quota.limit
                return rows, True
            rows.extend(page_rows)
            await progress_callback(len(rows), total)
            if not page_rows or (total > 0 and len(rows) >= total) or len(page_rows) < PAGE_SIZE:
                return rows, False
            page += 1
    return rows, True


class LhSource:
    def __init__(self, source_id: str, index_name: str, status_id: str, api_url: str, stage: str, build_document, request_params) -> None:
        self.source_id = source_id
        self.index_name = index_name
        self.status_id = status_id
        self.api_url = api_url
        self.stage = stage
        self.build_document = build_document
        self.request_params = request_params
        self.tasks: set[asyncio.Task] = set()
        self.lock = asyncio.Lock()

    async def save_status(self, status: dict) -> None:
        es = get_es()
        try:
            await es.index(index=SETTINGS_INDEX, id=self.status_id, document={"key": self.status_id, "value": status}, refresh=False)
        finally:
            await es.close()
        await notify_status_changed(self.source_id)

    async def get_status(self) -> dict:
        es = get_es()
        try:
            result = await es.get(index=SETTINGS_INDEX, id=self.status_id, ignore=[404])
            value = result.get("_source", {}).get("value", {}) if result.get("found") else {}
            value = value if isinstance(value, dict) else {}
            return {"status": "idle", "document_count": 0, **value, **DailyRequestQuota.from_status(value, DAILY_REQUEST_LIMIT).status_fields()}
        finally:
            await es.close()

    async def ensure_index(self) -> None:
        es = get_es()
        try:
            if await es.indices.exists(index=self.index_name):
                return
            await es.indices.create(index=self.index_name, settings={"number_of_shards": 1, "number_of_replicas": 0}, mappings={"properties": {
                "source_id": {"type": "keyword"}, "external_id": {"type": "keyword"}, "record_type": {"type": "keyword"}, "lifecycle_status": {"type": "keyword"},
                "title": {"type": "text"}, "content_text": {"type": "text"}, "agency": {"type": "keyword"}, "target": {"type": "text"}, "category": {"type": "keyword"},
                "user_type": {"type": "text"}, "support_type": {"type": "keyword"}, "summary": {"type": "text"}, "purpose": {"type": "text"}, "content": {"type": "text"},
                "selection_criteria": {"type": "text"}, "application_method": {"type": "text"}, "required_documents": {"type": "text"}, "contact": {"type": "text"},
                "application_deadline": {"type": "text"}, "application_end_date": {"type": "date", "format": "strict_date"}, "deadline_kind": {"type": "keyword"},
                "source_url": {"type": "keyword", "index": False}, "source_modified_at": {"type": "keyword"}, "fetched_at": {"type": "date"}, "raw": {"type": "object", "enabled": False},
            }})
        finally:
            await es.close()

    async def synchronize(self, service_key: str) -> None:
        async with self.lock:
            started_at = utc_now()
            previous = await self.get_status()
            quota = DailyRequestQuota.from_status(previous, DAILY_REQUEST_LIMIT)
            status = {"status": "running", "stage": self.stage, "current": 0, "total": 0, "started_at": started_at, "document_count": previous.get("document_count", 0), "last_successful_sync_at": previous.get("last_successful_sync_at"), **quota.status_fields()}
            await self.save_status(status)
            try:
                async def progress(current: int, total: int) -> None:
                    status.update({"current": current, "total": total, **quota.status_fields()})
                    await self.save_status(status)
                rows, quota_limited = await fetch_all(self.api_url, service_key, self.request_params(), quota, progress)
                if not rows:
                    raise LhApiError("LH API가 최신 데이터를 반환하지 않아 기존 데이터를 유지합니다.")
                fetched_at = utc_now()
                documents = [self.build_document(row, fetched_at) for row in rows]
                documents = [doc for doc in documents if doc and doc.get("external_id") and doc.get("title") and is_storable_by_deadline(doc)]
                status.update({"stage": "indexing", "current": 0, "total": len(documents)})
                await self.save_status(status)
                await self.ensure_index()
                es = get_es()
                try:
                    actions = [{"_op_type": "index", "_index": self.index_name, "_id": doc["external_id"], "_source": doc} for doc in documents]
                    indexed = 0
                    for offset in range(0, len(actions), BULK_CHUNK_SIZE):
                        chunk = actions[offset:offset + BULK_CHUNK_SIZE]
                        count, errors = await async_bulk(es, chunk, chunk_size=BULK_CHUNK_SIZE, refresh=False, raise_on_error=False)
                        if errors or count != len(chunk):
                            raise RuntimeError("LH 데이터 일부를 저장하지 못했습니다.")
                        indexed += count
                        status["current"] = indexed
                        await self.save_status(status)
                    if not quota_limited:
                        await es.delete_by_query(index=self.index_name, query={"range": {"fetched_at": {"lt": fetched_at}}}, conflicts="proceed", refresh=False)
                    await es.indices.refresh(index=self.index_name)
                    stored_count = int((await es.count(index=self.index_name)).get("count", len(documents)))
                finally:
                    await es.close()
                await self.save_status({"status": "failed" if quota_limited else "completed", "stage": "completed", "current": len(documents), "total": len(documents), "document_count": stored_count, "started_at": started_at, "completed_at": fetched_at, "last_successful_sync_at": previous.get("last_successful_sync_at") if quota_limited else fetched_at, "error_code": "request_limit_exceeded" if quota_limited else None, "partial_document_count": len(documents) if quota_limited else 0, **quota.status_fields()})
            except Exception as error:
                await self.save_status({**status, "status": "failed", "failed_at": utc_now(), "error": getattr(error, "error_code", "sync_failed"), "error_code": getattr(error, "error_code", "sync_failed"), **quota.status_fields()})

    def start(self, service_key: str) -> bool:
        if self.lock.locked() or any(not task.done() for task in self.tasks):
            return False
        task = asyncio.create_task(self.synchronize(service_key), name=f"external-data-{self.source_id}-sync")
        self.tasks.add(task)
        task.add_done_callback(self.tasks.discard)
        return True

    async def browse(self, query: str = "", search_after: list | None = None) -> dict:
        es = get_es()
        try:
            if not await es.indices.exists(index=self.index_name):
                return {"items": [], "total": 0, "next_cursor": None}
            search_query: dict = {"term": {"lifecycle_status": "active"}}
            sort: list[dict] = [{"source_modified_at": {"order": "desc", "missing": "_last"}}, {"external_id": {"order": "asc"}}]
            if query.strip():
                search_query = {"bool": {"filter": [{"term": {"lifecycle_status": "active"}}], "must": [{"multi_match": {"query": query.strip(), "fields": ["title^6", "agency^2", "target^4", "category^2", "support_type^3", "content_text"], "operator": "and"}}]}}
                sort.insert(0, {"_score": {"order": "desc"}})
            request = {"index": self.index_name, "size": BROWSE_PAGE_SIZE, "track_total_hits": True, "query": search_query, "sort": sort}
            if search_after:
                request["search_after"] = search_after
            result = await es.search(**request)
            hits = result.get("hits", {}).get("hits", [])
            keys = ("external_id", "title", "agency", "target", "category", "user_type", "support_type", "application_deadline", "application_end_date", "record_type", "source_url", "source_modified_at", "summary", "purpose", "content", "selection_criteria", "application_method", "required_documents", "contact")
            items = [{"id": hit.get("_source", {}).get("external_id", hit.get("_id", "")), **{key: hit.get("_source", {}).get(key, "") for key in keys if key != "external_id"}, "attachments": []} for hit in hits]
            return {"items": items, "total": result.get("hits", {}).get("total", {}).get("value", 0), "next_cursor": hits[-1].get("sort") if len(hits) == BROWSE_PAGE_SIZE else None}
        finally:
            await es.close()

    async def search(self, question: str, size: int = 8) -> list[dict]:
        es = get_es()
        try:
            if not await es.indices.exists(index=self.index_name) or not question.strip():
                return []
            result = await es.search(index=self.index_name, size=size, query={"bool": {"filter": [{"term": {"lifecycle_status": "active"}}], "must": [{"multi_match": {"query": question.strip(), "fields": ["title^6", "target^4", "agency^3", "category^2", "support_type^3", "content_text"], "operator": "or", "minimum_should_match": "20%"}}]}})
            return [{"id": source.get("external_id", hit.get("_id", "")), "title": source.get("title", ""), "content": source.get("content_text", "")[:1800], "url": source.get("source_url", ""), "source": "LH", "source_modified_at": source.get("source_modified_at", ""), "application_deadline": source.get("application_deadline", ""), "application_end_date": source.get("application_end_date"), "deadline_kind": source.get("deadline_kind", "unknown"), "score": hit.get("_score", 0), "external_resource_id": self.source_id} for hit in result.get("hits", {}).get("hits", []) for source in [hit.get("_source", {})]]
        finally:
            await es.close()
