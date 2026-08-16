from services.external_data.search import build_browser_search_query, build_candidate_search_query


def test_browser_search_matches_each_word_across_text_and_agency() -> None:
    query = build_browser_search_query("서울 주거비")

    term_queries = query["bool"]["must"]
    assert len(term_queries) == 2
    assert term_queries[0]["bool"]["should"][0]["multi_match"]["query"] == "서울"
    assert term_queries[0]["bool"]["should"][1]["wildcard"]["agency"]["value"] == "*서울*"
    assert term_queries[1]["bool"]["should"][0]["multi_match"]["query"] == "주거비"
    assert all(term_query["bool"]["minimum_should_match"] == 1 for term_query in term_queries)


def test_browser_search_keeps_source_filters() -> None:
    filters = [{"term": {"lifecycle_status": "active"}}]

    query = build_browser_search_query("청년", filters=filters)

    assert query["bool"]["filter"] == filters


def test_browser_search_escapes_wildcard_characters() -> None:
    query = build_browser_search_query("서울*")

    agency_query = query["bool"]["must"][0]["bool"]["should"][1]
    assert agency_query["wildcard"]["agency"]["value"] == "*서울\\**"


def test_candidate_search_boosts_complete_cross_field_match() -> None:
    query = build_candidate_search_query("주거비 서울", ["title^6", "content_text"])

    broad_match = query["bool"]["must"][0]["multi_match"]
    exact_match = query["bool"]["should"][0]["bool"]
    assert broad_match["operator"] == "or"
    assert broad_match["minimum_should_match"] == "20%"
    assert exact_match["boost"] == 10
    assert exact_match["must"][1]["bool"]["should"][1]["wildcard"]["agency"]["value"] == "*서울*"
