"""Background cleanup for external-data documents with known expired deadlines."""

import asyncio
from datetime import datetime

from logger import get_logger
from services.db import EXTERNAL_DATA_STATE_INDEX, get_es
from services.external_data.biz_support import INDEX_NAME as BIZ_SUPPORT_INDEX, SYNC_STATUS_DOC_ID as BIZ_SUPPORT_STATUS_ID
from services.external_data.gov24 import INDEX_NAME as GOV24_INDEX, SYNC_STATUS_DOC_ID as GOV24_STATUS_ID
from services.external_data.housing import INDEX_NAME as HOUSING_INDEX, SYNC_STATUS_DOC_ID as HOUSING_STATUS_ID
from services.external_data.lh_lease_complex import INDEX_NAME as LH_COMPLEX_INDEX, SYNC_STATUS_DOC_ID as LH_COMPLEX_STATUS_ID
from services.external_data.lh_lease_notice import INDEX_NAME as LH_NOTICE_INDEX, SYNC_STATUS_DOC_ID as LH_NOTICE_STATUS_ID
from services.external_data.k_startup import INDEX_NAME as K_STARTUP_INDEX, SYNC_STATUS_DOC_ID as K_STARTUP_STATUS_ID
from services.external_data.quota import KOREA_TIMEZONE

logger = get_logger(__name__)

CLEANUP_STATUS_DOC_ID = "external_data_expired_cleanup"
EXTERNAL_DATA_INDEXES = (
    GOV24_INDEX,
    BIZ_SUPPORT_INDEX,
    K_STARTUP_INDEX,
    HOUSING_INDEX,
    LH_COMPLEX_INDEX,
    LH_NOTICE_INDEX,
)
SYNC_STATUS_IDS = {
    GOV24_INDEX: GOV24_STATUS_ID,
    BIZ_SUPPORT_INDEX: BIZ_SUPPORT_STATUS_ID,
    K_STARTUP_INDEX: K_STARTUP_STATUS_ID,
    HOUSING_INDEX: HOUSING_STATUS_ID,
    LH_COMPLEX_INDEX: LH_COMPLEX_STATUS_ID,
    LH_NOTICE_INDEX: LH_NOTICE_STATUS_ID,
}

_cleanup_lock = asyncio.Lock()
_cleanup_tasks: set[asyncio.Task] = set()


def korea_date() -> str:
    return datetime.now(KOREA_TIMEZONE).date().isoformat()


async def get_cleanup_status() -> dict:
    es = get_es()
    try:
        result = await es.get(index=EXTERNAL_DATA_STATE_INDEX, id=CLEANUP_STATUS_DOC_ID, ignore=[404])
        if not result.get("found"):
            return {"status": "idle", "deleted_count": 0}
        value = result["_source"].get("value", {})
        return value if isinstance(value, dict) else {"status": "idle", "deleted_count": 0}
    finally:
        await es.close()


async def _save_cleanup_status(status: dict) -> None:
    es = get_es()
    try:
        await es.index(
            index=EXTERNAL_DATA_STATE_INDEX,
            id=CLEANUP_STATUS_DOC_ID,
            document={"key": CLEANUP_STATUS_DOC_ID, "value": status},
            refresh=False,
        )
    finally:
        await es.close()


async def delete_expired_documents() -> None:
    async with _cleanup_lock:
        cleanup_date = korea_date()
        started_at = datetime.now(KOREA_TIMEZONE).isoformat()
        status = {
            "status": "running",
            "cleanup_date": cleanup_date,
            "started_at": started_at,
            "deleted_count": 0,
        }
        await _save_cleanup_status(status)
        es = get_es()
        try:
            deleted_count = 0
            per_source: dict[str, int] = {}
            for index_name in EXTERNAL_DATA_INDEXES:
                if not await es.indices.exists(index=index_name):
                    continue
                result = await es.delete_by_query(
                    index=index_name,
                    query={"range": {"application_end_date": {"lt": cleanup_date}}},
                    conflicts="proceed",
                    refresh=True,
                    requests_per_second=200,
                )
                deleted = int(result.get("deleted") or 0)
                deleted_count += deleted
                per_source[index_name] = deleted
                sync_status_id = SYNC_STATUS_IDS[index_name]
                sync_status_result = await es.get(index=EXTERNAL_DATA_STATE_INDEX, id=sync_status_id, ignore=[404])
                if sync_status_result.get("found"):
                    sync_status = sync_status_result["_source"].get("value", {})
                    if isinstance(sync_status, dict):
                        document_count = int((await es.count(index=index_name)).get("count") or 0)
                        await es.index(
                            index=EXTERNAL_DATA_STATE_INDEX,
                            id=sync_status_id,
                            document={
                                "key": sync_status_id,
                                "value": {**sync_status, "document_count": document_count},
                            },
                            refresh=False,
                        )
                await asyncio.sleep(0)
            status = {
                **status,
                "status": "completed",
                "completed_at": datetime.now(KOREA_TIMEZONE).isoformat(),
                "deleted_count": deleted_count,
                "deleted_by_index": per_source,
            }
        except Exception as error:
            status = {
                **status,
                "status": "failed",
                "failed_at": datetime.now(KOREA_TIMEZONE).isoformat(),
                "error_code": "external_data_cleanup_failed",
            }
            logger.warning("[external-data] expired document cleanup failed: %s", error)
        finally:
            await es.close()
        await _save_cleanup_status(status)


def start_expired_document_cleanup() -> bool:
    if _cleanup_lock.locked() or any(not task.done() for task in _cleanup_tasks):
        return False
    task = asyncio.create_task(delete_expired_documents(), name="external-data-expired-cleanup")
    _cleanup_tasks.add(task)
    task.add_done_callback(_cleanup_tasks.discard)
    return True


def is_cleanup_running() -> bool:
    return _cleanup_lock.locked() or any(not task.done() for task in _cleanup_tasks)


async def is_cleanup_due() -> bool:
    status = await get_cleanup_status()
    return status.get("cleanup_date") != korea_date() or status.get("status") == "failed"
