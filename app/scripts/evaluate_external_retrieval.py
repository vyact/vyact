"""Generate and evaluate deterministic retrieval cases from the local external-data indices."""
from __future__ import annotations

import argparse
import asyncio
import json
import random
import re
from collections import defaultdict
from pathlib import Path

from reranker import is_available as is_reranker_available, load_reranker
from services.db import close_shared_es, get_es
from services.external_data import biz_support, gov24, housing, k_startup, lh_lease_complex, lh_lease_notice


RANDOM_SEED = 20260816
DEFAULT_CASES_PER_SOURCE = 30
DEFAULT_FIXTURE_PATH = Path(__file__).parents[1] / "tests" / "fixtures" / "rag_eval" / "external_data.jsonl"
DEFAULT_REPORT_PATH = Path(__file__).parents[1] / "tests" / "fixtures" / "rag_eval" / "external_data_report.json"
SOURCES = {
    biz_support.SOURCE_ID: (biz_support.INDEX_NAME, biz_support.search_candidates),
    k_startup.SOURCE_ID: (k_startup.INDEX_NAME, k_startup.search_candidates),
    gov24.SOURCE_ID: (gov24.INDEX_NAME, gov24.search_candidates),
    housing.SOURCE_ID: (housing.INDEX_NAME, housing.search_candidates),
    lh_lease_complex.SOURCE_ID: (lh_lease_complex.INDEX_NAME, lh_lease_complex.search_candidates),
    lh_lease_notice.SOURCE_ID: (lh_lease_notice.INDEX_NAME, lh_lease_notice.search_candidates),
}
NEGATIVE_QUERIES = [
    "안녕하세요",
    "오늘 저녁 메뉴를 추천해줘",
    "파이썬 리스트 정렬 방법",
    "이 문장을 영어로 번역해줘",
    "내 깃허브 저장소 목록을 보여줘",
]
NOISE_PATTERN = re.compile(
    r"(?:\[.*?\]|\(.*?\)|\b20\d{2}년\b|\b\d+차\b|추가|모집|공고|지원사업|참여기업|참가기업|신청)",
)


def _normalized_title(title: str) -> str:
    normalized = NOISE_PATTERN.sub(" ", title)
    return re.sub(r"\s+", " ", normalized).strip(" -·()[]")


def _build_queries(document: dict) -> list[tuple[str, str]]:
    title = str(document.get("title") or "").strip()
    normalized_title = _normalized_title(title)
    queries: list[tuple[str, str]] = []
    if len(normalized_title) >= 8:
        queries.append((normalized_title, "normalized_title"))

    metadata = [
        str(document.get(field) or "").strip()
        for field in ("target", "category", "support_type", "agency")
    ]
    metadata = [value for value in metadata if value and value not in normalized_title]
    if normalized_title and metadata:
        queries.append((f"{metadata[0]} 대상 {normalized_title} 알려줘", "natural_language"))
    return queries


async def _sample_documents(index_name: str, sample_size: int) -> list[dict]:
    es = get_es()
    try:
        response = await es.search(
            index=index_name,
            size=sample_size,
            query={
                "function_score": {
                    "query": {"bool": {"filter": [
                        {"exists": {"field": "external_id"}},
                        {"exists": {"field": "title"}},
                        {"term": {"lifecycle_status": "active"}},
                    ]}},
                    "random_score": {"seed": RANDOM_SEED, "field": "_seq_no"},
                }
            },
            source_includes=[
                "external_id", "title", "agency", "target", "category", "support_type",
            ],
        )
        return [hit.get("_source", {}) for hit in response.get("hits", {}).get("hits", [])]
    finally:
        await es.close()


async def _same_title_ids(index_name: str, title: str) -> list[str]:
    """Treat housing variants with the same visible title as equally relevant."""
    es = get_es()
    try:
        response = await es.search(
            index=index_name,
            size=100,
            query={"match_phrase": {"title": title}},
            source_includes=["external_id", "title"],
        )
        return sorted({
            str(source.get("external_id"))
            for hit in response.get("hits", {}).get("hits", [])
            for source in [hit.get("_source", {})]
            if source.get("external_id") and str(source.get("title") or "").strip() == title
        })
    finally:
        await es.close()


async def generate_fixture(path: Path, cases_per_source: int) -> list[dict]:
    randomizer = random.Random(RANDOM_SEED)
    cases: list[dict] = []
    for source_id, (index_name, _) in SOURCES.items():
        documents = await _sample_documents(index_name, cases_per_source * 4)
        source_cases: list[dict] = []
        relevant_ids_by_title: dict[str, list[str]] = {}
        for document in documents:
            external_id = str(document.get("external_id") or "")
            title = str(document.get("title") or "").strip()
            if not external_id:
                continue
            if title not in relevant_ids_by_title:
                relevant_ids_by_title[title] = await _same_title_ids(index_name, title)
            for query, query_type in _build_queries(document):
                source_cases.append({
                    "id": f"{source_id}:{external_id}:{query_type}",
                    "source": source_id,
                    "query": query,
                    "relevant_ids": relevant_ids_by_title[title] or [external_id],
                    "query_type": query_type,
                    "reference_title": document.get("title", ""),
                })
        randomizer.shuffle(source_cases)
        cases.extend(source_cases[:cases_per_source])
        cases.extend({
            "id": f"{source_id}:negative:{index}",
            "source": source_id,
            "query": query,
            "relevant_ids": [],
            "expected_empty": True,
            "query_type": "negative",
            "reference_title": "",
        } for index, query in enumerate(NEGATIVE_QUERIES, start=1))

    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        "".join(json.dumps(case, ensure_ascii=False) + "\n" for case in cases),
        encoding="utf-8",
    )
    return cases


async def evaluate_fixture(cases: list[dict], report_path: Path) -> dict:
    totals = defaultdict(lambda: {"cases": 0, "hits_at_1": 0, "hits_at_3": 0, "hits_at_8": 0, "reciprocal_rank": 0.0})
    failures: list[dict] = []
    ranking_misses: list[dict] = []
    negative_cases = 0
    negative_false_positives = 0
    score_samples = defaultdict(lambda: {"positive_expected": [], "negative_top": []})
    for case in cases:
        _, search = SOURCES[case["source"]]
        results = await search(case["query"], size=8)
        result_ids = [str(result.get("id") or "") for result in results]
        if case.get("expected_empty"):
            negative_cases += 1
            if results:
                score_samples[case["source"]]["negative_top"].append(
                    results[0].get("rerank_score", results[0].get("score", 0))
                )
            if results:
                negative_false_positives += 1
                failures.append({
                    **case,
                    "returned_ids": result_ids,
                    "returned_titles": [result.get("title", "") for result in results],
                    "returned_scores": [result.get("rerank_score", result.get("score", 0)) for result in results],
                })
            continue
        expected = set(case["relevant_ids"])
        rank = next((index + 1 for index, result_id in enumerate(result_ids) if result_id in expected), None)
        expected_score = next((
            result.get("rerank_score", result.get("score", 0))
            for result in results
            if str(result.get("id") or "") in expected
        ), None)
        if expected_score is not None:
            score_samples[case["source"]]["positive_expected"].append(expected_score)
        for bucket in ("overall", case["source"], f"type:{case['query_type']}"):
            totals[bucket]["cases"] += 1
            if rank:
                totals[bucket]["hits_at_8"] += 1
                totals[bucket]["hits_at_3"] += int(rank <= 3)
                totals[bucket]["hits_at_1"] += int(rank == 1)
                totals[bucket]["reciprocal_rank"] += 1 / rank
        if not rank:
            failures.append({
                **case,
                "returned_ids": result_ids,
                "returned_titles": [result.get("title", "") for result in results],
                "returned_scores": [result.get("rerank_score", result.get("score", 0)) for result in results],
            })
        elif rank > 1:
            ranking_misses.append({
                **case,
                "rank": rank,
                "expected_score": expected_score,
                "returned_ids": result_ids,
                "returned_titles": [result.get("title", "") for result in results],
                "returned_scores": [result.get("rerank_score", result.get("score", 0)) for result in results],
            })

    metrics = {
        bucket: {
            "cases": values["cases"],
            "precision_at_1": round(values["hits_at_1"] / values["cases"], 4) if values["cases"] else 0,
            "recall_at_3": round(values["hits_at_3"] / values["cases"], 4) if values["cases"] else 0,
            "recall_at_8": round(values["hits_at_8"] / values["cases"], 4) if values["cases"] else 0,
            "mrr_at_8": round(values["reciprocal_rank"] / values["cases"], 4) if values["cases"] else 0,
        }
        for bucket, values in totals.items()
    }
    report = {
        "reranker_available": is_reranker_available(),
        "metrics": metrics,
        "failure_count": len(failures),
        "ranking_miss_count": len(ranking_misses),
        "negative_metrics": {
            "cases": negative_cases,
            "false_positive_rate": round(negative_false_positives / negative_cases, 4) if negative_cases else 0,
        },
        "score_samples": dict(score_samples),
        "failures": failures,
        "ranking_misses": ranking_misses,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    return report


async def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--fixture", type=Path, default=DEFAULT_FIXTURE_PATH)
    parser.add_argument("--report", type=Path, default=DEFAULT_REPORT_PATH)
    parser.add_argument("--cases-per-source", type=int, default=DEFAULT_CASES_PER_SOURCE)
    parser.add_argument("--generate", action="store_true")
    parser.add_argument("--load-reranker", action="store_true")
    parser.add_argument("--negative-only", action="store_true")
    arguments = parser.parse_args()

    try:
        if arguments.load_reranker:
            loaded = await asyncio.to_thread(load_reranker)
            if not loaded:
                raise RuntimeError("Reranker could not be loaded")
        if arguments.generate or not arguments.fixture.exists():
            cases = await generate_fixture(arguments.fixture, arguments.cases_per_source)
        else:
            cases = [json.loads(line) for line in arguments.fixture.read_text(encoding="utf-8").splitlines() if line.strip()]
        if arguments.negative_only:
            cases = [case for case in cases if case.get("expected_empty")]
        report = await evaluate_fixture(cases, arguments.report)
        print(json.dumps(report["metrics"], ensure_ascii=False, indent=2))
        print(
            f"failures={report['failure_count']} ranking_misses={report['ranking_miss_count']} "
            f"fixture={arguments.fixture} report={arguments.report}"
        )
    finally:
        await close_shared_es()


if __name__ == "__main__":
    asyncio.run(main())
