"""External public-data connection settings API."""

import json

from fastapi import APIRouter, HTTPException, Query
from pydantic import BaseModel

from services.external_data.gov24 import browse_documents, get_sync_status, start_synchronization
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

SUPPORTED_SOURCE_IDS = {"kr.gov24"}


class ExternalDataConnectionRequest(BaseModel):
    service_key: str


class ExternalDataScheduleRequest(BaseModel):
    enabled: bool
    interval_hours: int


@router.get("/external-data/connections")
async def get_external_data_connections():
    connections = await load_external_data_connections()
    return {
        "connections": {
            source_id: {"has_service_key": bool(config.get("service_key"))}
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
async def start_gov24_sync():
    connections = await load_external_data_connections()
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if start_synchronization(service_key):
        return {"status": "started"}

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
