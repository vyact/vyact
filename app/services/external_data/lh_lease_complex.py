"""LH rental-housing complex synchronization."""

from services.external_data.lh_common import DAILY_REQUEST_LIMIT, LhSource, format_money, stable_id

SOURCE_ID = "kr.lh_lease_complex"
INDEX_NAME = "external_data_kr_lh_lease_complex"
SYNC_STATUS_DOC_ID = "external_data_sync_kr_lh_lease_complex"
API_URL = "https://apis.data.go.kr/B552555/lhLeaseInfo1/lhLeaseInfo1"


def _build_document(item: dict, fetched_at: str) -> dict:
    region = str(item.get("ARA_NM") or "").strip()
    supply_type = str(item.get("AIS_TP_CD_NM") or "").strip()
    complex_name = str(item.get("SBD_LGO_NM") or "").strip()
    area = str(item.get("DDO_AR") or "").strip()
    deposit = format_money(item.get("LS_GMY"))
    monthly_rent = format_money(item.get("RFE"))
    occupancy = str(item.get("MVIN_XPC_YM") or "").strip()
    content_parts = [
        f"지역: {region}" if region else "", f"공급유형: {supply_type}" if supply_type else "",
        f"전용면적: {area}㎡" if area else "", f"임대보증금: {deposit}" if deposit else "",
        f"월임대료: {monthly_rent}" if monthly_rent else "",
        f"단지 총 세대수: {item.get('SUM_HSH_CNT')}" if item.get("SUM_HSH_CNT") not in (None, "") else "",
        f"주택형 세대수: {item.get('HSH_CNT')}" if item.get("HSH_CNT") not in (None, "") else "",
        f"최초 입주 예정: {occupancy}" if occupancy else "",
    ]
    content = "\n".join(part for part in content_parts if part)
    return {
        "source_id": SOURCE_ID, "external_id": stable_id(region, supply_type, complex_name, area, deposit, monthly_rent),
        "record_type": "lease_complex", "lifecycle_status": "active", "title": complex_name, "content_text": content,
        "agency": "한국토지주택공사", "target": region, "category": supply_type, "user_type": "", "support_type": supply_type,
        "summary": " · ".join(filter(None, [region, supply_type, f"보증금 {deposit}" if deposit else "", f"월 {monthly_rent}" if monthly_rent else ""])),
        "purpose": "", "content": content, "selection_criteria": "", "application_method": "https://apply.lh.or.kr",
        "required_documents": "", "contact": "", "application_deadline": "", "application_end_date": None,
        "deadline_kind": "unknown", "source_url": "https://apply.lh.or.kr", "source_modified_at": str(item.get("RS_DTTM") or ""),
        "fetched_at": fetched_at, "raw": item,
    }


_source = LhSource(SOURCE_ID, INDEX_NAME, SYNC_STATUS_DOC_ID, API_URL, "lhLeaseComplex", _build_document, lambda: {})
get_sync_status = _source.get_status
start_synchronization = _source.start
browse_documents = _source.browse
search_candidates = _source.search

