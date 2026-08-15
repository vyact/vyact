from datetime import datetime, timezone

import httpx

from services.external_data.housing import (
    HousingApiError,
    _build_document,
    _format_date,
    _items_and_total,
    _latest_month_range,
    _parse_api_response,
)


def test_latest_month_range_uses_rolling_twelve_month_window():
    begin, end = _latest_month_range(datetime(2026, 8, 15, tzinfo=timezone.utc))
    assert begin == "202509"
    assert end == "202608"


def test_items_and_total_accepts_single_item_object():
    records, total = _items_and_total({
        "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE"},
        "body": {"totalCount": "1", "item": {"pblancId": "P1", "pblancNm": "행복주택 모집"}},
    })
    assert total == 1
    assert records[0]["pblancId"] == "P1"


def test_build_document_normalizes_dates_and_housing_fields():
    document = _build_document({
        "pblancId": "P1",
        "houseSn": 10,
        "pblancNm": "서울 행복주택 모집",
        "suplyInsttNm": "한국토지주택공사",
        "suplyTyNm": "행복주택",
        "houseTyNm": "아파트",
        "brtcNm": "서울특별시",
        "signguNm": "강남구",
        "hsmpNm": "테스트 단지",
        "beginDe": "20260820",
        "endDe": "20260831",
        "rcritPblancDe": "2026-08-15",
        "pcUrl": "https://example.com/housing",
        "rentGtn": 10000000,
        "mtRntchrg": 250000,
    }, "rental", "2026-08-15T00:00:00+00:00")
    assert document["external_id"] == "rental:P1:10"
    assert document["application_end_date"] == "2026-08-31"
    assert document["target"] == "서울특별시 강남구"
    assert "10,000,000원" in document["content_text"]
    assert _format_date("2026.08.31") == "2026-08-31"


def test_common_xml_request_limit_error_is_classified():
    response = httpx.Response(200, text="""
        <OpenAPI_ServiceResponse><cmmMsgHeader>
          <returnAuthMsg>일일 서비스 요청제한 횟수 초과 에러</returnAuthMsg>
          <returnReasonCode>22</returnReasonCode>
        </cmmMsgHeader></OpenAPI_ServiceResponse>
    """)
    try:
        _parse_api_response(response)
    except HousingApiError as error:
        assert error.error_code == "request_limit_exceeded"
    else:
        raise AssertionError("HousingApiError was not raised")
