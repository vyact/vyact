from services.external_data.biz_support import _build_document, _items_and_total, _xml_items_and_total


def test_parses_standard_public_data_response():
    payload = {
        "response": {
            "header": {"resultCode": "00", "resultMsg": "NORMAL SERVICE."},
            "body": {
                "items": {"item": [{"pblancId": "A1", "pblancNm": "지원 공고"}]},
                "totalCount": 1,
            },
        },
    }

    items, total = _items_and_total(payload)

    assert total == 1
    assert items[0]["pblancId"] == "A1"


def test_normalizes_bizinfo_announcement_fields():
    document = _build_document({
        "pblancId": "A1",
        "pblancNm": "소상공인 사업화 지원",
        "jrsdInsttNm": "중소벤처기업부",
        "excInsttNm": "지원기관",
        "bsnsSumryCn": "사업화 비용을 지원합니다.",
        "pldirSportRealmLclasCodeNm": "기술",
        "trgetNm": "중소기업",
        "reqstBeginEndDe": "2026-08-01 ~ 2026-08-31",
        "reqstMthPapersCn": "이메일 접수",
        "refrncNm": "지원기관 02-1234-5678",
        "rceptEngnHmpgUrl": "https://example.com/apply",
        "creatPnttm": "2026-08-14 14:58:30",
        "updtPnttm": "2026-08-14 15:26:07",
        "inqireCo": "661",
        "fileNm": "신청서.hwp@결과보고서.hwp",
        "flpthNm": "https://example.com/1@https://example.com/2",
        "pblancUrl": "https://example.com/announcement",
    }, "2026-08-14T00:00:00+00:00")

    assert document["external_id"] == "A1"
    assert document["title"] == "소상공인 사업화 지원"
    assert document["category"] == "기술"
    assert document["target"] == "중소기업"
    assert document["application_end_date"] == "2026-08-31"
    assert document["application_method"] == "이메일 접수"
    assert document["contact"] == "지원기관 02-1234-5678"
    assert document["application_url"] == "https://example.com/apply"
    assert document["created_at"] == "2026-08-14 14:58:30"
    assert document["source_modified_at"] == "2026-08-14 15:26:07"
    assert document["view_count"] == 661
    assert document["attachments"] == [
        {"name": "신청서.hwp", "url": "https://example.com/1"},
        {"name": "결과보고서.hwp", "url": "https://example.com/2"},
    ]
    assert document["source_url"] == "https://example.com/announcement"


def test_parses_actual_xml_response_shape():
    items, total = _xml_items_and_total("""
        <response>
          <header><resultCode>00</resultCode><resultMsg>NORMAL_SERVICE</resultMsg></header>
          <body><items><item>
            <pblancId>PBLN_1</pblancId>
            <pblancNm><![CDATA[소상공인 지원 공고]]></pblancNm>
            <bsnsSumryCn><![CDATA[<p>사업화 비용을 지원합니다.</p>]]></bsnsSumryCn>
          </item></items><totalCount>1</totalCount></body>
        </response>
    """)

    assert total == 1
    assert items[0]["pblancId"] == "PBLN_1"
    assert _build_document(items[0], "2026-08-14T00:00:00+00:00")["content_text"].endswith("사업화 비용을 지원합니다.")
