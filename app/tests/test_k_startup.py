from services.external_data.k_startup import (
    _announcement_document,
    _business_document,
    _items_and_total,
)


def test_parses_k_startup_response_shape():
    items, total = _items_and_total({
        "currentCount": 1,
        "data": {"data": [{"pbanc_sn": "A1", "biz_pbanc_nm": "창업 지원"}]},
        "totalCount": 17,
    })

    assert total == 17
    assert items[0]["pbanc_sn"] == "A1"


def test_normalizes_k_startup_announcement():
    document = _announcement_document({
        "pbanc_sn": "A1",
        "biz_pbanc_nm": "예비창업패키지",
        "pbanc_ctnt": "<p>사업화 자금을 지원합니다.</p>",
        "supt_biz_clsfc": "사업화",
        "aply_trgt_ctnt": "예비창업자",
        "biz_enyy": "예비창업자",
        "pbanc_rcpt_bgng_dt": "20260801",
        "pbanc_rcpt_end_dt": "20260831",
        "sprv_inst": "중소벤처기업부",
        "biz_prch_dprt_nm": "창업지원실",
        "prch_cnpl_no": "1357",
        "aply_mthd_onli_rcpt_istc": "K-Startup 온라인 신청",
        "detl_pg_url": "https://example.com/detail",
        "biz_aply_url": "https://example.com/apply",
    }, "2026-08-14T00:00:00+00:00")

    assert document["external_id"] == "announcement:A1"
    assert document["title"] == "예비창업패키지"
    assert document["target"] == "예비창업자"
    assert document["application_end_date"] == "2026-08-31"
    assert document["application_method"] == "K-Startup 온라인 신청"
    assert document["application_url"] == "https://example.com/apply"
    assert document["summary"] == "사업화 자금을 지원합니다."


def test_normalizes_k_startup_business_information():
    document = _business_document({
        "biz_yr": 2026,
        "biz_category_cd": "사업화",
        "supt_biz_titl_nm": "초기창업패키지",
        "biz_supt_trgt_info": "창업 3년 이내 기업",
        "biz_supt_bdgt_info": "최대 1억원",
        "biz_supt_ctnt": "사업화 자금 및 교육",
        "supt_biz_intrd_info": "초기기업의 성장을 지원합니다.",
        "detl_pg_url": "https://example.com/program/1",
    }, "2026-08-14T00:00:00+00:00")

    assert document["record_type"] == "business"
    assert document["title"] == "초기창업패키지"
    assert document["target"] == "창업 3년 이내 기업"
    assert "최대 1억원" in document["content_text"]
    assert document["deadline_kind"] == "unknown"
