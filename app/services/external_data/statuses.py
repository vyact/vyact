"""Bulk loading for external-data synchronization status documents."""

from services.db import SETTINGS_INDEX, get_es
from services.external_data.biz_support import DAILY_REQUEST_LIMIT as BIZ_LIMIT, SYNC_STATUS_DOC_ID as BIZ_STATUS_ID
from services.external_data.gov24 import DAILY_REQUEST_LIMIT as GOV24_LIMIT, SYNC_STATUS_DOC_ID as GOV24_STATUS_ID
from services.external_data.housing import DAILY_REQUEST_LIMIT as HOUSING_LIMIT, SYNC_STATUS_DOC_ID as HOUSING_STATUS_ID
from services.external_data.k_startup import DAILY_REQUEST_LIMIT as STARTUP_LIMIT, SYNC_STATUS_DOC_ID as STARTUP_STATUS_ID
from services.external_data.lh_lease_complex import DAILY_REQUEST_LIMIT as LH_COMPLEX_LIMIT, SYNC_STATUS_DOC_ID as LH_COMPLEX_STATUS_ID
from services.external_data.lh_lease_notice import DAILY_REQUEST_LIMIT as LH_NOTICE_LIMIT, SYNC_STATUS_DOC_ID as LH_NOTICE_STATUS_ID
from services.external_data.quota import DailyRequestQuota

SOURCE_STATUS_DOCUMENTS = {
    "kr.gov24": (GOV24_STATUS_ID, GOV24_LIMIT),
    "kr.biz_support": (BIZ_STATUS_ID, BIZ_LIMIT),
    "kr.k_startup": (STARTUP_STATUS_ID, STARTUP_LIMIT),
    "kr.housing": (HOUSING_STATUS_ID, HOUSING_LIMIT),
    "kr.lh_lease_complex": (LH_COMPLEX_STATUS_ID, LH_COMPLEX_LIMIT),
    "kr.lh_lease_notice": (LH_NOTICE_STATUS_ID, LH_NOTICE_LIMIT),
}


async def load_sync_statuses(source_ids: list[str]) -> dict[str, dict]:
    selected = {
        source_id: SOURCE_STATUS_DOCUMENTS[source_id]
        for source_id in source_ids
        if source_id in SOURCE_STATUS_DOCUMENTS
    }
    if not selected:
        return {}

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
    statuses = {}
    for source_id, (document_id, request_limit) in selected.items():
        status = values.get(document_id, {})
        if not isinstance(status, dict):
            status = {}
        statuses[source_id] = {
            "status": "idle",
            "document_count": 0,
            **status,
            **DailyRequestQuota.from_status(status, request_limit).status_fields(),
        }
    return statuses
