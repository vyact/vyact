"""Evaluate saved-document retrieval against a small human-authored query set."""
import asyncio
import json
from pathlib import Path

from agent import _gather_related_context
from reranker import load_reranker
from services.db import close_shared_es


REPORT_PATH = Path(__file__).parents[1] / "tests" / "fixtures" / "rag_eval" / "document_report.json"
CASES = [
    ("국방 AI 전략에서 제안하는 신뢰 기반 책임있는 AI 프레임워크는 무엇인가?", "8c424c9e-84f1-4375-930c-82f3de89bce4"),
    ("자율살상무기체계 LAWS 국제 논의에서 인간 책임은 어떻게 다뤄지는가?", "8c424c9e-84f1-4375-930c-82f3de89bce4"),
    ("기업이 책임있는 AI를 위해 라이프사이클 단계별로 해야 할 활동은?", "c230df82-1b20-4728-a10b-0ac5926fdddc"),
    ("이루다 챗봇과 아마존 채용 AI 사례가 보여주는 윤리 문제는?", "c230df82-1b20-4728-a10b-0ac5926fdddc"),
    ("How do institutional investors affect multi-class share structures and valuation discounts?", "7d4d594a-f9b7-43b8-aae9-b6a913506489"),
    ("What are the merits and costs of differential voting rights and dual-class shares?", "7d4d594a-f9b7-43b8-aae9-b6a913506489"),
    ("How does stock overvaluation influence green patenting among Korean listed firms?", "cf5cf16a-940d-4d46-81ea-c16609129712"),
    ("Does equity financing or a catering mechanism explain green patent filings?", "cf5cf16a-940d-4d46-81ea-c16609129712"),
    ("What drives return asymmetry in Counter-Strike 2 skins: starting price or rarity tier?", "b2bfcdc8-5d4a-45b1-9e1a-5e7ce0be1722"),
    ("What legal ownership and tail risks arise when investing in CS2 virtual items?", "b2bfcdc8-5d4a-45b1-9e1a-5e7ce0be1722"),
    ("How does relative firm size determine bargaining power in patent transactions?", "e4b6ec2a-cf24-43fe-af99-b2f0452929be"),
    ("Why can large buyers' bargaining power reduce smaller firms' incentives to innovate?", "e4b6ec2a-cf24-43fe-af99-b2f0452929be"),
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
