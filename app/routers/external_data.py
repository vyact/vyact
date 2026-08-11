"""External public-data connection settings API."""

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services.db import SETTINGS_INDEX, get_es
from services.external_data.gov24 import get_sync_status, start_synchronization

router = APIRouter()

EXTERNAL_DATA_SETTINGS_DOC_ID = "external_data_connections"
SUPPORTED_SOURCE_IDS = {"kr.gov24"}


class ExternalDataConnectionRequest(BaseModel):
    service_key: str


async def _load_connections() -> dict:
    es = get_es()
    try:
        result = await es.get(
            index=SETTINGS_INDEX,
            id=EXTERNAL_DATA_SETTINGS_DOC_ID,
            ignore=[404],
        )
        if not result.get("found"):
            return {}
        value = result["_source"].get("value", {})
        return value if isinstance(value, dict) else {}
    finally:
        await es.close()


@router.get("/external-data/connections")
async def get_external_data_connections():
    connections = await _load_connections()
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

    connections = await _load_connections()
    connections[source_id] = {"service_key": service_key}
    es = get_es()
    try:
        await es.index(
            index=SETTINGS_INDEX,
            id=EXTERNAL_DATA_SETTINGS_DOC_ID,
            document={"key": EXTERNAL_DATA_SETTINGS_DOC_ID, "value": connections},
            refresh=True,
        )
    finally:
        await es.close()
    return {"source_id": source_id, "has_service_key": True}


@router.get("/external-data/sources/kr.gov24/sync")
async def get_gov24_sync_status():
    return await get_sync_status()


@router.post("/external-data/sources/kr.gov24/sync")
async def start_gov24_sync():
    connections = await _load_connections()
    service_key = (connections.get("kr.gov24") or {}).get("service_key", "")
    if not service_key:
        raise HTTPException(400, "A service key is required.")
    if not start_synchronization(service_key):
        raise HTTPException(409, "Synchronization is already running.")
    return {"status": "started"}
