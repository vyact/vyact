import unittest
from unittest.mock import AsyncMock, patch

from services.external_data import search


class ExternalDataRerankTests(unittest.IsolatedAsyncioTestCase):
    async def test_reranker_filters_low_relevance_candidates(self):
        ranked = [
            {"id": "relevant", "rerank_score": 0.8},
            {"id": "irrelevant", "rerank_score": 0.1},
        ]
        with patch.object(search, "is_reranker_available", return_value=True), patch.object(
            search,
            "rerank",
            new=AsyncMock(return_value=ranked),
        ):
            results = await search.select_relevant_candidates("question", ranked, size=8)

        self.assertEqual([result["id"] for result in results], ["relevant"])

    async def test_reranker_unavailable_does_not_inject_unverified_candidates(self):
        candidates = [{"id": str(index)} for index in range(20)]
        with patch.object(search, "is_reranker_available", return_value=False):
            results = await search.select_relevant_candidates("question", candidates, size=8)

        self.assertEqual(results, [])


if __name__ == "__main__":
    unittest.main()
