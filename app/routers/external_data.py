"""External public-data connection settings API."""

import asyncio
import json

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.external_data.biz_support import (
    browse_documents as browse_biz_support_documents,
    get_sync_status as get_biz_support_sync_status,
    start_synchronization as start_biz_support_synchronization,
)
from services.external_data.gov24 import browse_documents, get_sync_status, start_synchronization
from services.external_data.k_startup import (
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
    load_external_data_connections,
    save_external_data_connections,
)

router = APIRouter()

SUPPORTED_SOURCE_IDS = {
    "kr.gov24",
    "kr.biz_support",
    "kr.k_startup",
    "kr.welfare",
    "kr.content_support",
    "kr.scholarship",
}


class ExternalDataConnectionRequest(BaseModel):
    service_key: str


class ExternalDataSourceStateRequest(BaseModel):
    enabled: bool


class ExternalDataScheduleRequest(BaseModel):
    enabled: bool
    interval_hours: int


async def _wait_for_synchronization(get_status_callback) -> dict:
    for _ in range(3600):
        await asyncio.sleep(0.25)
        status = await get_status_callback()
        if status.get("status") != "running":
            return {"status": status.get("status", "completed"), "sync_status": status}
    raise HTTPException(504, "External data synchronization timed out.")


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
    if not enabled_sources:
        raise HTTPException(400, "No synchronized external data source is enabled.")

    async def event_stream():
        if "kr.gov24" in enabled_sources:
            start_synchronization(service_key)
        if "kr.biz_support" in enabled_sources:
            start_biz_support_synchronization(service_key)
        if "kr.k_startup" in enabled_sources:
            start_k_startup_synchronization(service_key)
        previous_payload = ""
        for _ in range(3600):
            await asyncio.sleep(0.25)
            statuses = {}
            if "kr.gov24" in enabled_sources:
                statuses["kr.gov24"] = await get_sync_status()
            if "kr.biz_support" in enabled_sources:
                statuses["kr.biz_support"] = await get_biz_support_sync_status()
            if "kr.k_startup" in enabled_sources:
                statuses["kr.k_startup"] = await get_k_startup_sync_status()
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
        start_synchronization(service_key)
        previous_payload = ""
        for _ in range(3600):
            await asyncio.sleep(0.25)
            status = await get_sync_status()
            payload = json.dumps(status, ensure_ascii=False)
            if payload != previous_payload:
                yield f"data: {payload}\n\n"
                previous_payload = payload
            if status.get("status") in {"completed", "failed"}:
                return
        timeout_status = {"status": "failed", "error": "Government24 synchronization timed out."}
        yield f"data: {json.dumps(timeout_status)}\n\n"

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
        start_k_startup_synchronization(service_key)
        previous_payload = ""
        for _ in range(3600):
            await asyncio.sleep(0.25)
            status = await get_k_startup_sync_status()
            payload = json.dumps(status, ensure_ascii=False)
            if payload != previous_payload:
                yield f"data: {payload}\n\n"
                previous_payload = payload
            if status.get("status") in {"completed", "failed"}:
                return
        timeout_status = {"status": "failed", "error": "K-Startup synchronization timed out."}
        yield f"data: {json.dumps(timeout_status)}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )
