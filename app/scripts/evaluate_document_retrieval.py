"""Evaluate saved-document retrieval against a small human-authored query set."""
import asyncio
import json
from pathlib import Path

from agent import _gather_related_context
from reranker import load_reranker
from services.db import close_shared_es


REPORT_PATH = Path(__file__).parents[1] / "tests" / "fixtures" / "rag_eval" / "document_report.json"
CASES = [
    ("국방 AI 전략에서 제안하는 신뢰 기반 책임있는 AI 프레임워크는 무엇인가?", "2e752225-5499-4e31-a2d3-a9fa1f56cab7"),
    ("자율살상무기체계 LAWS 국제 논의에서 인간 책임은 어떻게 다뤄지는가?", "2e752225-5499-4e31-a2d3-a9fa1f56cab7"),
    ("기업이 책임있는 AI를 위해 라이프사이클 단계별로 해야 할 활동은?", "f2205f69-aacd-4a58-adbb-7f13a3c4c595"),
    ("이루다 챗봇과 아마존 채용 AI 사례가 보여주는 윤리 문제는?", "f2205f69-aacd-4a58-adbb-7f13a3c4c595"),
    ("How do institutional investors affect multi-class share structures and valuation discounts?", "4a4b74ba-e05c-4505-b800-083df5410b39"),
    ("What are the merits and costs of differential voting rights and dual-class shares?", "4a4b74ba-e05c-4505-b800-083df5410b39"),
    ("How does stock overvaluation influence green patenting among Korean listed firms?", "dbe27698-e9a7-41a1-941e-9db701a4b6ee"),
    ("Does equity financing or a catering mechanism explain green patent filings?", "dbe27698-e9a7-41a1-941e-9db701a4b6ee"),
    ("What drives return asymmetry in Counter-Strike 2 skins: starting price or rarity tier?", "46c85fee-b4d9-417d-8218-cb0b9b6ec5c9"),
    ("What legal ownership and tail risks arise when investing in CS2 virtual items?", "46c85fee-b4d9-417d-8218-cb0b9b6ec5c9"),
]


async def main() -> None:
    if not await asyncio.to_thread(load_reranker):
        raise RuntimeError("Reranker could not be loaded")
    results = []
    try:
        for query, expected_file_id in CASES:
            documents = await _gather_related_context(query)
            retrieved_file_ids = [document.get("file_id") for document in documents]
            rank = next((index + 1 for index, file_id in enumerate(retrieved_file_ids) if file_id == expected_file_id), None)
            results.append({
                "query": query,
                "expected_file_id": expected_file_id,
                "rank": rank,
                "retrieved": [{
                    "file_id": document.get("file_id"),
                    "title": document.get("title"),
                    "page_number": document.get("page_number"),
                    "rerank_score": document.get("rerank_score"),
                } for document in documents],
            })
    finally:
        await close_shared_es()
    hits = [result for result in results if result["rank"]]
    report = {
        "cases": len(results),
        "recall_at_8": len(hits) / len(results),
        "precision_at_1": sum(result["rank"] == 1 for result in results) / len(results),
        "mrr_at_8": sum(1 / result["rank"] for result in hits) / len(results),
        "results": results,
    }
    REPORT_PATH.parent.mkdir(parents=True, exist_ok=True)
    REPORT_PATH.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({key: value for key, value in report.items() if key != "results"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    asyncio.run(main())
