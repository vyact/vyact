"""Shared lexical search helpers for external-data browser lists."""

import re

from reranker import is_available as is_reranker_available, rerank


BROWSER_TEXT_FIELDS = ["title^6", "content_text"]
AGENCY_FIELD = "agency"
RERANK_CANDIDATE_SIZE = 20
RERANK_SCORE_THRESHOLD = 0.35


def _escape_wildcard(value: str) -> str:
    return re.sub(r"([\\*?])", r"\\\1", value)


def build_browser_search_query(query: str, filters: list[dict] | None = None) -> dict:
    """Require every word across title, details, or the agency/location value."""
    normalized_query = re.sub(r"\s+", " ", query).strip()
    if not normalized_query:
        return {"bool": {"filter": filters}} if filters else {"match_all": {}}

    term_queries = []
    for term in normalized_query.split(" "):
        term_queries.append({
            "bool": {
                "should": [
                    {"multi_match": {
                        "query": term,
                        "fields": BROWSER_TEXT_FIELDS,
                        "type": "best_fields",
                    }},
                    {"wildcard": {
                        AGENCY_FIELD: {
                            "value": f"*{_escape_wildcard(term)}*",
                            "case_insensitive": True,
                            "boost": 2,
                        },
                    }},
                ],
                "minimum_should_match": 1,
            },
        })

    bool_query: dict = {
        "must": term_queries,
        "should": [{"match_phrase": {"title": {"query": normalized_query, "boost": 20}}}],
    }
    if filters:
        bool_query["filter"] = filters
    return {"bool": bool_query}


def build_candidate_search_query(
    question: str,
    fields: list[str],
    filters: list[dict] | None = None,
) -> dict:
    """Keep natural-language recall broad while boosting complete cross-field matches."""
    normalized_question = re.sub(r"\s+", " ", question).strip()
    exact_match = build_browser_search_query(normalized_question)
    exact_match["bool"]["boost"] = 10
    bool_query: dict = {
        "must": [{"multi_match": {
            "query": normalized_question,
            "fields": fields,
            "type": "best_fields",
            "operator": "or",
            "minimum_should_match": "20%",
        }}],
        "should": [exact_match],
    }
    if filters:
        bool_query["filter"] = filters
    return {"bool": bool_query}


async def select_relevant_candidates(question: str, candidates: list[dict], size: int) -> list[dict]:
    """Apply the same semantic relevance gate to every external-data source."""
    if not candidates:
        return []
    if not is_reranker_available():
        return candidates[:size]
    ranked = await rerank(question, candidates, top_k=size)
    return [
        candidate for candidate in ranked
        if candidate.get("rerank_score", 0) >= RERANK_SCORE_THRESHOLD
    ]
