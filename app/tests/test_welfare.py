from services.external_data.welfare import (
    WelfareApiError,
    _build_document,
    _parse_detail_response,
    _parse_list_response,
)

def test_parse_list_response_reads_repeated_services():
    records, total = _parse_list_response("""
        <wantedList><totalCount>2</totalCount><resultCode>0</resultCode>
          <servList><servId>A1</servId><servNm>첫 번째 복지</servNm></servList>
          <servList><servId>A2</servId><servNm>두 번째 복지</servNm></servList>
        </wantedList>
    """)
    assert total == 2
    assert [record["servId"] for record in records] == ["A1", "A2"]


def test_parse_detail_and_build_search_document():
    detail = _parse_detail_response("""
        <wantedDtl><resultCode>0</resultCode><servId>A1</servId><servNm>청년 지원</servNm>
          <jurMnofNm>보건복지부</jurMnofNm><tgtrDtlCn><![CDATA[<p>만 19세 이상</p>]]></tgtrDtlCn>
          <slctCritCn>소득 기준 충족</slctCritCn><alwServCn>월 10만원 지원</alwServCn>
          <applmetList><servSeCode>01</servSeCode><servSeDetailNm>온라인 신청</servSeDetailNm><servSeDetailLink>https://example.com/apply</servSeDetailLink></applmetList>
        </wantedDtl>
    """)
    document = _build_document(
        {"servId": "A1", "servNm": "청년 지원", "servDgst": "청년 생활 지원", "servDtlLink": "https://example.com/detail"},
        detail,
        "2026-08-15T00:00:00+00:00",
    )
    assert document["external_id"] == "A1"
    assert document["target"] == "만 19세 이상"
    assert document["application_method"] == "온라인 신청 · https://example.com/apply"
    assert "월 10만원 지원" in document["content_text"]


def test_request_limit_error_is_classified():
    try:
        _parse_detail_response("""
            <OpenAPI_ServiceResponse><cmmMsgHeader>
              <errMsg>LIMITED NUMBER OF SERVICE REQUESTS EXCEEDS ERROR</errMsg>
              <returnAuthMsg>일일 서비스 요청제한 횟수 초과 에러</returnAuthMsg>
              <returnReasonCode>22</returnReasonCode>
            </cmmMsgHeader></OpenAPI_ServiceResponse>
        """)
    except WelfareApiError as error:
        assert error.error_code == "request_limit_exceeded"
        assert "요청제한" in str(error)
    else:
        raise AssertionError("WelfareApiError was not raised")
