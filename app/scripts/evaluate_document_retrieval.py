"""Evaluate saved-document retrieval against a small human-authored query set."""
import asyncio
import json
from pathlib import Path

from agent import _gather_related_context
from reranker import load_reranker
from services.db import close_shared_es


REPORT_PATH = Path(__file__).parents[1] / "tests" / "fixtures" / "rag_eval" / "document_report.json"
CASES = [
    ("국방 AI 전략에서 제안하는 신뢰 기반 책임있는 AI 프레임워크는 무엇인가?", "2387b886-4228-49de-85bb-bef3af102e61"),
    ("자율살상무기체계 LAWS 국제 논의에서 인간 책임은 어떻게 다뤄지는가?", "2387b886-4228-49de-85bb-bef3af102e61"),
    ("기업이 책임있는 AI를 위해 라이프사이클 단계별로 해야 할 활동은?", "94de2237-0d2d-414d-a49b-6ca796b872f8"),
    ("이루다 챗봇과 아마존 채용 AI 사례가 보여주는 윤리 문제는?", "94de2237-0d2d-414d-a49b-6ca796b872f8"),
    ("How do institutional investors affect multi-class share structures and valuation discounts?", "f2b4a287-6877-4e86-b867-fa743e5d90a6"),
    ("What are the merits and costs of differential voting rights and dual-class shares?", "f2b4a287-6877-4e86-b867-fa743e5d90a6"),
    ("How does stock overvaluation influence green patenting among Korean listed firms?", "ab2f973c-fb12-4f51-a712-0dfc17ca9b57"),
    ("Does equity financing or a catering mechanism explain green patent filings?", "ab2f973c-fb12-4f51-a712-0dfc17ca9b57"),
    ("What drives return asymmetry in Counter-Strike 2 skins: starting price or rarity tier?", "5136bd4a-9c61-4df7-93cf-c50aa5f03ba9"),
    ("What legal ownership and tail risks arise when investing in CS2 virtual items?", "5136bd4a-9c61-4df7-93cf-c50aa5f03ba9"),
    ("How does relative firm size determine bargaining power in patent transactions?", "05bb3dac-5387-4c22-bea7-be0b302b3149"),
    ("Why can large buyers' bargaining power reduce smaller firms' incentives to innovate?", "05bb3dac-5387-4c22-bea7-be0b302b3149"),
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
