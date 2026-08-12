from services.external_data.gov24 import _candidate_query


def test_candidate_query_is_language_and_domain_agnostic() -> None:
    question = "Find housing grants for a self-employed parent in Lyon"

    query = _candidate_query(question)
    multi_match = query["bool"]["must"][0]["multi_match"]

    assert multi_match["query"] == question
    assert multi_match["operator"] == "or"
    assert "title^6" in multi_match["fields"]


def test_candidate_query_keeps_lifecycle_and_deadline_filters() -> None:
    query = _candidate_query("청년 주거 지원")

    filters = query["bool"]["filter"]
    assert filters[0] == {"term": {"lifecycle_status": "active"}}
    assert filters[1]["bool"]["minimum_should_match"] == 1
