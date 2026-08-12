from services.external_data.gov24 import _candidate_query, extract_search_intent


def test_extract_search_intent_removes_request_noise_and_region() -> None:
    question = (
        "정부24 외부 데이터에서 부산광역시 강서구의 국민건강보험료 지원서비스를 찾아줘. "
        "지원 대상, 지원 내용, 신청 필요 여부, 문의처와 정부24 원문 링크를 알려줘."
    )

    core_query, regions = extract_search_intent(question)

    assert core_query == "국민건강보험료"
    assert regions == ["부산광역시 강서구"]


def test_candidate_query_requires_all_core_terms_in_strict_stage() -> None:
    query = _candidate_query("건강보험료 감면", ["부산광역시 강서구"], strict=True)
    bool_query = query["bool"]
    multi_match = bool_query["must"][0]["bool"]["should"][1]["multi_match"]

    assert multi_match["operator"] == "and"
    assert bool_query["must"][0]["bool"]["minimum_should_match"] == 1
    assert bool_query["should"][0]["wildcard"]["agency"]["boost"] == 5


def test_candidate_query_uses_controlled_fallback() -> None:
    query = _candidate_query("건강보험료 감면", [], strict=False)
    multi_match = query["bool"]["must"][0]["bool"]["should"][1]["multi_match"]

    assert multi_match["operator"] == "or"
    assert multi_match["minimum_should_match"] == "50%"
