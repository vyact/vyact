"""External public-data connection settings API."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.db import SETTINGS_INDEX, get_es
from services.external_data.cleanup import CLEANUP_STATUS_DOC_ID, get_cleanup_status
from services.external_data.biz_support import (
    DAILY_REQUEST_LIMIT as BIZ_SUPPORT_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as BIZ_SUPPORT_STATUS_ID,
    browse_documents as browse_biz_support_documents,
    get_sync_status as get_biz_support_sync_status,
    start_synchronization as start_biz_support_synchronization,
)
from services.external_data.gov24 import (
    DAILY_REQUEST_LIMIT as GOV24_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as GOV24_STATUS_ID,
    browse_documents,
    get_sync_status,
    start_synchronization,
)
from services.external_data.housing import (
    DAILY_REQUEST_LIMIT as HOUSING_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as HOUSING_STATUS_ID,
    browse_documents as browse_housing_documents,
    get_sync_status as get_housing_sync_status,
    start_synchronization as start_housing_synchronization,
)
from services.external_data.lh_lease_complex import (
    DAILY_REQUEST_LIMIT as LH_COMPLEX_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as LH_COMPLEX_STATUS_ID,
    browse_documents as browse_lh_complex_documents,
    get_sync_status as get_lh_complex_sync_status,
    start_synchronization as start_lh_complex_synchronization,
)
from services.external_data.lh_lease_notice import (
    DAILY_REQUEST_LIMIT as LH_NOTICE_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as LH_NOTICE_STATUS_ID,
    browse_documents as browse_lh_notice_documents,
    get_sync_status as get_lh_notice_sync_status,
    start_synchronization as start_lh_notice_synchronization,
)
from services.external_data.k_startup import (
    DAILY_REQUEST_LIMIT as K_STARTUP_REQUEST_LIMIT,
    SYNC_STATUS_DOC_ID as K_STARTUP_STATUS_ID,
    browse_documents as browse_k_startup_documents,
    get_sync_status as get_k_startup_sync_status,
    start_synchronization as start_k_startup_synchronization,
)
from services.external_data.scheduler import (
    ALLOWED_INTERVAL_HOURS,
    DEFAULT_INTERVAL_HOURS,
    request_external_data_schedule_check,
)
from services.external_data.settings import (
    EXTERNAL_DATA_SETTINGS_DOC_ID,
    load_external_data_connections,
    save_external_data_connections,
)
from services.external_data.quota import DailyRequestQuota
from services.external_data.status_events import status_versions, wait_for_status_change

router = APIRouter()

SUPPORTED_SOURCE_IDS = {
    "kr.gov24",
    "kr.biz_support",
    "kr.k_startup",
    "kr.housing",
    "kr.lh_lease_complex",
    "kr.lh_lease_notice",
}
SOURCE_STATUS_DOCUMENTS = {
    "kr.gov24": (GOV24_STATUS_ID, GOV24_REQUEST_LIMIT),
    "kr.biz_support": (BIZ_SUPPORT_STATUS_ID, BIZ_SUPPORT_REQUEST_LIMIT),
    "kr.k_startup": (K_STARTUP_STATUS_ID, K_STARTUP_REQUEST_LIMIT),
    "kr.housing": (HOUSING_STATUS_ID, HOUSING_REQUEST_LIMIT),
    "kr.lh_lease_complex": (LH_COMPLEX_STATUS_ID, LH_COMPLEX_REQUEST_LIMIT),
    "kr.lh_lease_notice": (LH_NOTICE_STATUS_ID, LH_NOTICE_REQUEST_LIMIT),
}

LH_SOURCE_HANDLERS = {
    "kr.lh_lease_complex": (get_lh_complex_sync_status, start_lh_complex_synchronization, browse_lh_complex_documents, "lhLeaseComplex"),
    "kr.lh_lease_notice": (get_lh_notice_sync_status, start_lh_notice_synchronization, browse_lh_notice_documents, "lhLeaseNotice"),
}

BROWSE_SOURCE_HANDLERS = {
    "kr.gov24": browse_documents,
    "kr.biz_support": browse_biz_support_documents,
    "kr.k_startup": browse_k_startup_documents,
    "kr.housing": browse_housing_documents,
    "kr.lh_lease_complex": browse_lh_complex_documents,
    "kr.lh_lease_notice": browse_lh_notice_documents,
}


class ExternalDataConnectionRequest(BaseModel):
    service_key: str


class ExternalDataSourceStateRequest(BaseModel):
    enabled: bool


class ExternalDataScheduleRequest(BaseModel):
    enabled: bool
    interval_hours: int


class ExternalDataCleanupRequest(BaseModel):
    enabled: bool


class ExternalDataPromptRequest(BaseModel):
    instruction: str


@router.get("/external-data/documents")
async def browse_all_external_data(
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=8000),
):
    cursors: dict[str, list] = {}
    if cursor:
        try:
            decoded_cursor = json.loads(cursor)
            if not isinstance(decoded_cursor, dict) or any(
                source_id not in BROWSE_SOURCE_HANDLERS or not isinstance(value, list)
                for source_id, value in decoded_cursor.items()
            ):
                raise ValueError
            cursors = decoded_cursor
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None

    connections = await load_external_data_connections()
    enabled_source_ids = [
        source_id
        for source_id in BROWSE_SOURCE_HANDLERS
        if (connections.get(source_id) or {}).get("enabled", source_id == "kr.gov24")
        and (cursor is None or source_id in cursors)
    ]
    results = await asyncio.gather(*(
        BROWSE_SOURCE_HANDLERS[source_id](query, cursors.get(source_id))
        for source_id in enabled_source_ids
    ), return_exceptions=True)

    items = []
    total = 0
    next_cursors = {}
    successful_results = 0
    for source_id, result in zip(enabled_source_ids, results, strict=True):
        if isinstance(result, BaseException):
            continue
        successful_results += 1
        total += int(result.get("total", 0))
        items.extend({**item, "source_id": source_id} for item in result.get("items", []))
        if result.get("next_cursor") is not None:
            next_cursors[source_id] = result["next_cursor"]

    if enabled_source_ids and not successful_results:
        raise HTTPException(503, "External data could not be loaded.")
    return {
        "items": items,
        "total": total,
        "next_cursor": json.dumps(next_cursors, ensure_ascii=False) if next_cursors else None,
    }


def _normalized_sync_status(status: dict, request_limit: int) -> dict:
    normalized = {
        "status": "idle",
        "document_count": 0,
        **status,
        **DailyRequestQuota.from_status(status, request_limit).status_fields(),
    }
    normalized.pop("error", None)
    return normalized


async def _load_source_statuses(source_ids: list[str]) -> dict[str, dict]:
    selected = {
        source_id: SOURCE_STATUS_DOCUMENTS[source_id]
        for source_id in source_ids
        if source_id in SOURCE_STATUS_DOCUMENTS
    }
    es = get_es()
    try:
        result = await es.mget(
            index=SETTINGS_INDEX,
            ids=[document_id for document_id, _ in selected.values()],
        )
    finally:
        await es.close()
    values = {
        document.get("_id"): document.get("_source", {}).get("value", {})
        for document in result.get("docs", [])
        if document.get("found")
    }
    return {
        source_id: _normalized_sync_status(
            values.get(document_id, {}) if isinstance(values.get(document_id, {}), dict) else {},
            request_limit,
        )
        for source_id, (document_id, request_limit) in selected.items()
    }


async def _wait_for_synchronization(get_status_callback) -> dict:
    for _ in range(900):
        await asyncio.sleep(1.0)
        status = await get_status_callback()
        if status.get("status") != "running":
            public_status = {**status}
            public_status.pop("error", None)
            return {"status": status.get("status", "completed"), "sync_status": public_status}
    raise HTTPException(504, "External data synchronization timed out.")


async def _single_source_status_stream(source_id: str, start_callback, get_status_callback):
    initial_versions = status_versions([source_id])
    started = start_callback()
    if started:
        await wait_for_status_change(initial_versions, timeout_seconds=2.0)
    previous_payload = ""
    for _ in range(240):
        versions = status_versions([source_id])
        status = await get_status_callback()
        public_status = {**status}
        public_status.pop("error", None)
        payload = json.dumps(public_status, ensure_ascii=False)
        if payload != previous_payload:
            yield f"data: {payload}\n\n"
            previous_payload = payload
        if status.get("status") in {"completed", "failed"}:
            return
        await wait_for_status_change(versions)
        await asyncio.sleep(0.5)
    timeout_status = {"status": "failed", "error": "External data synchronization timed out."}
    yield f"data: {json.dumps(timeout_status)}\n\n"


@router.post("/external-data/sync/events")
async def stream_all_external_data_sync():
    connections = await load_external_data_connections()
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    enabled_sources = []
    if (connections.get("kr.gov24") or {}).get("enabled", True):
        enabled_sources.append("kr.gov24")
    if (connections.get("kr.biz_support") or {}).get("enabled", False):
        enabled_sources.append("kr.biz_support")
    if (connections.get("kr.k_startup") or {}).get("enabled", False):
        enabled_sources.append("kr.k_startup")
    if (connections.get("kr.housing") or {}).get("enabled", False):
        enabled_sources.append("kr.housing")
    for source_id in LH_SOURCE_HANDLERS:
        if (connections.get(source_id) or {}).get("enabled", False):
            enabled_sources.append(source_id)
    if not enabled_sources:
        raise HTTPException(400, "No synchronized external data source is enabled.")

    async def event_stream():
        initial_versions = status_versions(enabled_sources)
        started_any = False
        if "kr.gov24" in enabled_sources:
            started_any = start_synchronization(service_key) or started_any
        if "kr.biz_support" in enabled_sources:
            started_any = start_biz_support_synchronization(service_key) or started_any
        if "kr.k_startup" in enabled_sources:
            started_any = start_k_startup_synchronization(service_key) or started_any
        if "kr.housing" in enabled_sources:
            started_any = start_housing_synchronization(service_key) or started_any
        for source_id, (_, start_callback, _, _) in LH_SOURCE_HANDLERS.items():
            if source_id in enabled_sources:
                started_any = start_callback(service_key) or started_any
        if started_any:
            await wait_for_status_change(initial_versions, timeout_seconds=2.0)
        previous_payload = ""
        for _ in range(240):
            versions = status_versions(enabled_sources)
            statuses = await _load_source_statuses(enabled_sources)
            source_states = [status.get("status") for status in statuses.values()]
            all_finished = bool(source_states) and all(
                state in {"completed", "failed"} for state in source_states
            )
            overall_status = "running"
            if all_finished:
                overall_status = "failed" if "failed" in source_states else "completed"
            event = {"status": overall_status, "sources": statuses}
            payload = json.dumps(event, ensure_ascii=False)
            if payload != previous_payload:
                yield f"data: {payload}\n\n"
                previous_payload = payload
            if all_finished:
                return
            await wait_for_status_change(versions)
            await asyncio.sleep(0.5)
        timeout_event = {"status": "failed", "error": "External data synchronization timed out."}
        yield f"data: {json.dumps(timeout_event)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/external-data/connections")
async def get_external_data_connections():
    connections = await load_external_data_connections()
    return {
        "connections": {
            source_id: {
                "has_service_key": bool(config.get("service_key")),
                "enabled": bool(config.get("enabled", source_id == "kr.gov24")),
            }
            for source_id, config in connections.items()
            if source_id in SUPPORTED_SOURCE_IDS and isinstance(config, dict)
        }
    }


@router.get("/external-data/bootstrap")
async def get_external_data_bootstrap():
    document_ids = [
        EXTERNAL_DATA_SETTINGS_DOC_ID,
        *(document_id for document_id, _ in SOURCE_STATUS_DOCUMENTS.values()),
        CLEANUP_STATUS_DOC_ID,
    ]
    es = get_es()
    try:
        result = await es.mget(index=SETTINGS_INDEX, ids=document_ids)
    finally:
        await es.close()
    values = {
        document.get("_id"): document.get("_source", {}).get("value", {})
        for document in result.get("docs", [])
        if document.get("found")
    }
    connections = values.get(EXTERNAL_DATA_SETTINGS_DOC_ID, {})
    if not isinstance(connections, dict):
        connections = {}
    statuses = {}
    for source_id, (document_id, request_limit) in SOURCE_STATUS_DOCUMENTS.items():
        status = values.get(document_id, {})
        if not isinstance(status, dict):
            status = {}
        statuses[source_id] = _normalized_sync_status(status, request_limit)
    cleanup_status = values.get(CLEANUP_STATUS_DOC_ID, {})
    if not isinstance(cleanup_status, dict):
        cleanup_status = {"status": "idle", "deleted_count": 0}
    config = connections.get("kr.gov24") or {}
    interval_hours = config.get("auto_sync_interval_hours", DEFAULT_INTERVAL_HOURS)
    if interval_hours not in ALLOWED_INTERVAL_HOURS:
        interval_hours = DEFAULT_INTERVAL_HOURS
    return {
        "connections": {
            source_id: {
                "has_service_key": bool(source_config.get("service_key")),
                "enabled": bool(source_config.get("enabled", source_id == "kr.gov24")),
            }
            for source_id, source_config in connections.items()
            if source_id in SUPPORTED_SOURCE_IDS and isinstance(source_config, dict)
        },
        "statuses": statuses,
        "schedule": {
            "enabled": bool(config.get("auto_sync_enabled", False)),
            "interval_hours": interval_hours,
        },
        "cleanup": {
            "enabled": bool(config.get("auto_delete_expired_enabled", False)),
            "cleanup_status": cleanup_status,
        },
        "prompt": {
            "instruction": str(config.get("custom_instruction") or ""),
        },
    }


@router.put("/external-data/connections/{source_id}")
async def save_external_data_connection(
    source_id: str,
    request: ExternalDataConnectionRequest,
):
    if source_id not in SUPPORTED_SOURCE_IDS:
        raise HTTPException(404, "Unsupported external data source.")
    service_key = request.service_key.strip()
    if not service_key:
        raise HTTPException(400, "A service key is required.")

    connections = await load_external_data_connections()
    connections[source_id] = {**(connections.get(source_id) or {}), "service_key": service_key}
    await save_external_data_connections(connections)
    return {"source_id": source_id, "has_service_key": True}


@router.put("/external-data/sources/{source_id}/enabled")
async def save_external_data_source_state(
    source_id: str,
    request: ExternalDataSourceStateRequest,
):
    if source_id not in SUPPORTED_SOURCE_IDS:
        raise HTTPException(404, "Unsupported external data source.")
    connections = await load_external_data_connections()
    connections[source_id] = {
        **(connections.get(source_id) or {}),
        "enabled": request.enabled,
    }
    await save_external_data_connections(connections)
    request_external_data_schedule_check()
    return {"source_id": source_id, "enabled": request.enabled}


@router.get("/external-data/sources/kr.gov24/sync")
async def get_gov24_sync_status():
    return await get_sync_status()


@router.get("/external-data/sources/kr.gov24/documents")
async def browse_gov24_documents(
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=1000),
):
    search_after = None
    if cursor:
        try:
            parsed_cursor = json.loads(cursor)
            if not isinstance(parsed_cursor, list):
                raise ValueError
            search_after = parsed_cursor
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None
    result = await browse_documents(query, search_after)
    if result["next_cursor"] is not None:
        result["next_cursor"] = json.dumps(result["next_cursor"], ensure_ascii=False)
    return result


@router.get("/external-data/sources/kr.gov24/schedule")
async def get_gov24_schedule():
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    interval_hours = config.get("auto_sync_interval_hours", DEFAULT_INTERVAL_HOURS)
    if interval_hours not in ALLOWED_INTERVAL_HOURS:
        interval_hours = DEFAULT_INTERVAL_HOURS
    return {
        "enabled": bool(config.get("auto_sync_enabled", False)),
        "interval_hours": interval_hours,
    }


@router.put("/external-data/sources/kr.gov24/schedule")
async def save_gov24_schedule(request: ExternalDataScheduleRequest):
    if request.interval_hours not in ALLOWED_INTERVAL_HOURS:
        raise HTTPException(400, "Unsupported synchronization interval.")
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    if request.enabled and not config.get("service_key"):
        raise HTTPException(400, "A service key is required.")
    connections["kr.gov24"] = {
        **config,
        "auto_sync_enabled": request.enabled,
        "auto_sync_interval_hours": request.interval_hours,
    }
    await save_external_data_connections(connections)
    request_external_data_schedule_check()
    return {"enabled": request.enabled, "interval_hours": request.interval_hours}


@router.get("/external-data/cleanup")
async def get_external_data_cleanup():
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    return {
        "enabled": bool(config.get("auto_delete_expired_enabled", False)),
        "cleanup_status": await get_cleanup_status(),
    }


@router.put("/external-data/cleanup")
async def save_external_data_cleanup(request: ExternalDataCleanupRequest):
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    connections["kr.gov24"] = {
        **config,
        "auto_delete_expired_enabled": request.enabled,
    }
    await save_external_data_connections(connections)
    request_external_data_schedule_check()
    return {"enabled": request.enabled, "cleanup_status": await get_cleanup_status()}


@router.put("/external-data/prompt")
async def save_external_data_prompt(request: ExternalDataPromptRequest):
    instruction = request.instruction.strip()
    if len(instruction) > 4_000:
        raise HTTPException(400, "External data instruction is too long.")
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    connections["kr.gov24"] = {**config, "custom_instruction": instruction}
    await save_external_data_connections(connections)
    return {"instruction": instruction}


@router.post("/external-data/sources/kr.gov24/sync")
async def start_gov24_sync(wait: bool = Query(default=False)):
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    if not config.get("enabled", True):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = config.get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if start_synchronization(service_key):
        if wait:
            return await _wait_for_synchronization(get_sync_status)
        return {"status": "started"}

    if wait:
        return await _wait_for_synchronization(get_sync_status)

    current_status = await get_sync_status()
    if current_status.get("status") != "running":
        # create_task 직후 동기화 코루틴이 상태를 저장하기 전 들어온 요청도
        # 기존 작업에 합류하도록 초기 진행 상태를 반환한다.
        current_status = {
            **current_status,
            "status": "running",
            "stage": "list",
            "current": 0,
            "total": 0,
        }
    return {"status": "already_running", "sync_status": current_status}


@router.post("/external-data/sources/kr.gov24/sync/events")
async def stream_gov24_sync():
    connections = await load_external_data_connections()
    config = connections.get("kr.gov24") or {}
    if not config.get("enabled", True):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = config.get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")

    async def event_stream():
        async for event in _single_source_status_stream(
            "kr.gov24", lambda: start_synchronization(service_key), get_sync_status
        ):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/external-data/sources/kr.biz_support/sync")
async def get_biz_support_sync():
    return await get_biz_support_sync_status()


@router.get("/external-data/sources/kr.biz_support/documents")
async def browse_biz_support_data(
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=1000),
):
    search_after = None
    if cursor:
        try:
            search_after = json.loads(cursor)
            if not isinstance(search_after, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None
    result = await browse_biz_support_documents(query, search_after)
    if result["next_cursor"] is not None:
        result["next_cursor"] = json.dumps(result["next_cursor"], ensure_ascii=False)
    return result


@router.post("/external-data/sources/kr.biz_support/sync")
async def start_biz_support_sync(wait: bool = Query(default=False)):
    connections = await load_external_data_connections()
    config = connections.get("kr.biz_support") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if start_biz_support_synchronization(service_key):
        if wait:
            return await _wait_for_synchronization(get_biz_support_sync_status)
        return {"status": "started"}
    if wait:
        return await _wait_for_synchronization(get_biz_support_sync_status)
    current_status = await get_biz_support_sync_status()
    if current_status.get("status") != "running":
        current_status = {**current_status, "status": "running", "stage": "list", "current": 0, "total": 0}
    return {"status": "already_running", "sync_status": current_status}


@router.post("/external-data/sources/kr.biz_support/sync/events")
async def stream_biz_support_sync():
    connections = await load_external_data_connections()
    config = connections.get("kr.biz_support") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")

    return StreamingResponse(
        _single_source_status_stream(
            "kr.biz_support",
            lambda: start_biz_support_synchronization(service_key),
            get_biz_support_sync_status,
        ),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/external-data/sources/kr.k_startup/sync")
async def get_k_startup_sync():
    return await get_k_startup_sync_status()


@router.get("/external-data/sources/kr.k_startup/documents")
async def browse_k_startup_data(
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=1000),
):
    search_after = None
    if cursor:
        try:
            search_after = json.loads(cursor)
            if not isinstance(search_after, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None
    result = await browse_k_startup_documents(query, search_after)
    if result["next_cursor"] is not None:
        result["next_cursor"] = json.dumps(result["next_cursor"], ensure_ascii=False)
    return result


@router.post("/external-data/sources/kr.k_startup/sync")
async def start_k_startup_sync(wait: bool = Query(default=False)):
    connections = await load_external_data_connections()
    config = connections.get("kr.k_startup") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if start_k_startup_synchronization(service_key):
        if wait:
            return await _wait_for_synchronization(get_k_startup_sync_status)
        return {"status": "started"}
    if wait:
        return await _wait_for_synchronization(get_k_startup_sync_status)
    current_status = await get_k_startup_sync_status()
    if current_status.get("status") != "running":
        current_status = {**current_status, "status": "running", "stage": "startupAnnouncements", "current": 0, "total": 0}
    return {"status": "already_running", "sync_status": current_status}


@router.post("/external-data/sources/kr.k_startup/sync/events")
async def stream_k_startup_sync():
    connections = await load_external_data_connections()
    config = connections.get("kr.k_startup") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")

    async def event_stream():
        async for event in _single_source_status_stream(
            "kr.k_startup", lambda: start_k_startup_synchronization(service_key), get_k_startup_sync_status
        ):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/external-data/sources/kr.housing/sync")
async def get_housing_sync():
    return await get_housing_sync_status()


@router.get("/external-data/sources/kr.housing/documents")
async def browse_housing_data(
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=1000),
):
    search_after = None
    if cursor:
        try:
            search_after = json.loads(cursor)
            if not isinstance(search_after, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None
    result = await browse_housing_documents(query, search_after)
    if result["next_cursor"] is not None:
        result["next_cursor"] = json.dumps(result["next_cursor"], ensure_ascii=False)
    return result


@router.post("/external-data/sources/kr.housing/sync")
async def start_housing_sync(wait: bool = Query(default=False)):
    connections = await load_external_data_connections()
    config = connections.get("kr.housing") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if start_housing_synchronization(service_key):
        if wait:
            return await _wait_for_synchronization(get_housing_sync_status)
        return {"status": "started"}
    if wait:
        return await _wait_for_synchronization(get_housing_sync_status)
    current_status = await get_housing_sync_status()
    if current_status.get("status") != "running":
        current_status = {**current_status, "status": "running", "stage": "housingRental", "current": 0, "total": 0}
    return {"status": "already_running", "sync_status": current_status}


@router.post("/external-data/sources/kr.housing/sync/events")
async def stream_housing_sync():
    connections = await load_external_data_connections()
    config = connections.get("kr.housing") or {}
    if not config.get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")

    async def event_stream():
        async for event in _single_source_status_stream(
            "kr.housing", lambda: start_housing_synchronization(service_key), get_housing_sync_status
        ):
            yield event

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/external-data/sources/{source_id:path}/sync")
async def get_lh_source_sync(source_id: str):
    handler = LH_SOURCE_HANDLERS.get(source_id)
    if not handler:
        raise HTTPException(404, "External data source not found.")
    return await handler[0]()


@router.get("/external-data/sources/{source_id:path}/documents")
async def browse_lh_source_data(
    source_id: str,
    query: str = Query(default="", max_length=200),
    cursor: str | None = Query(default=None, max_length=1000),
):
    handler = LH_SOURCE_HANDLERS.get(source_id)
    if not handler:
        raise HTTPException(404, "External data source not found.")
    search_after = None
    if cursor:
        try:
            search_after = json.loads(cursor)
            if not isinstance(search_after, list):
                raise ValueError
        except (json.JSONDecodeError, ValueError):
            raise HTTPException(400, "Invalid pagination cursor.") from None
    result = await handler[2](query, search_after)
    if result["next_cursor"] is not None:
        result["next_cursor"] = json.dumps(result["next_cursor"], ensure_ascii=False)
    return result


@router.post("/external-data/sources/{source_id:path}/sync")
async def start_lh_source_sync(source_id: str, wait: bool = Query(default=False)):
    handler = LH_SOURCE_HANDLERS.get(source_id)
    if not handler:
        raise HTTPException(404, "External data source not found.")
    connections = await load_external_data_connections()
    if not (connections.get(source_id) or {}).get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    get_status_callback, start_callback, _, stage = handler
    if start_callback(service_key):
        return await _wait_for_synchronization(get_status_callback) if wait else {"status": "started"}
    if wait:
        return await _wait_for_synchronization(get_status_callback)
    current_status = await get_status_callback()
    if current_status.get("status") != "running":
        current_status = {**current_status, "status": "running", "stage": stage, "current": 0, "total": 0}
    return {"status": "already_running", "sync_status": current_status}


@router.post("/external-data/sources/{source_id:path}/sync/events")
async def stream_lh_source_sync(source_id: str):
    handler = LH_SOURCE_HANDLERS.get(source_id)
    if not handler:
        raise HTTPException(404, "External data source not found.")
    connections = await load_external_data_connections()
    if not (connections.get(source_id) or {}).get("enabled", False):
        raise HTTPException(400, "The external data source is disabled.")
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    get_status_callback, start_callback, _, _ = handler

    async def event_stream():
        async for event in _single_source_status_stream(source_id, lambda: start_callback(service_key), get_status_callback):
            yield event

    return StreamingResponse(event_stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
