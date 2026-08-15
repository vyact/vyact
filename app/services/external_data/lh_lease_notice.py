"""LH sale and rental notice synchronization."""

import re
from datetime import datetime, timedelta, timezone

from services.external_data.lh_common import DAILY_REQUEST_LIMIT, LhSource, stable_id

SOURCE_ID = "kr.lh_lease_notice"
INDEX_NAME = "external_data_kr_lh_lease_notice"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_lh_lease_notice"
API_URL = "https://apis.data.go.kr/B552555/lhLeaseNoticeInfo1/lhLeaseNoticeInfo1"


def _request_params() -> dict:
    today = datetime.now(timezone.utc).date()
    return {"PAN_NT_ST_DT": (today - timedelta(days=365)).strftime("%Y.%m.%d"), "CLSG_DT": (today + timedelta(days=365)).strftime("%Y.%m.%d")}


def _build_document(item: dict, fetched_at: str) -> dict | None:
    status = str(item.get("PAN_SS") or "").strip()
    if any(closed in status for closed in ("마감", "종료", "취소")):
        return None
    title = str(item.get("PAN_NM") or "").strip()
    notice_type = str(item.get("UPP_AIS_TP_NM") or "").strip()
    detail_type = str(item.get("AIS_TP_CD_NM") or "").strip()
    region = str(item.get("CNP_CD_NM") or "").strip()
    url = str(item.get("DTL_URL") or "").strip()
    id_match = re.search(r"(?:PAN_ID|panId)=([^&]+)", url)
    external_id = id_match.group(1) if id_match else stable_id(title, notice_type, detail_type, region)
    content_parts = [f"공고유형: {notice_type}" if notice_type else "", f"세부유형: {detail_type}" if detail_type else "", f"지역: {region}" if region else "", f"공고상태: {status}" if status else ""]
    content = "\n".join(part for part in content_parts if part)
    return {
        "source_id": SOURCE_ID, "external_id": external_id, "record_type": "lh_notice", "lifecycle_status": "active",
        "title": title, "content_text": content, "agency": "한국토지주택공사", "target": region, "category": detail_type,
        "user_type": "", "support_type": notice_type, "summary": " · ".join(filter(None, [region, notice_type, detail_type, status])),
        "purpose": "", "content": content, "selection_criteria": "", "application_method": url, "required_documents": "", "contact": "",
        "application_deadline": status, "application_end_date": None, "deadline_kind": "unknown", "source_url": url,
        "source_modified_at": str(item.get("RS_DTTM") or ""), "fetched_at": fetched_at, "raw": item,
    }


_source = LhSource(SOURCE_ID, INDEX_NAME, SYNC_STATUS_DOC_ID, API_URL, "lhLeaseNotice", _build_document, _request_params)
get_sync_status = _source.get_status
start_synchronization = _source.start
browse_documents = _source.browse
search_candidates = _source.search
