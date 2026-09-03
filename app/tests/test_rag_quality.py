import unittest
from unittest.mock import AsyncMock, patch

import agent
import reranker
from services import embedding_runtime
from services import indexer
from services import chat_file_index


class RetrievalCandidateTests(unittest.IsolatedAsyncioTestCase):
    def test_distinct_web_chunks_are_not_deduplicated_by_url(self):
        first = {"url": "https://example.com/guide", "web_document_id": "guide", "chunk_index": 1}
        second = {"url": "https://example.com/guide", "web_document_id": "guide", "chunk_index": 2}

        self.assertNotEqual(agent._retrieval_candidate_key(first), agent._retrieval_candidate_key(second))

    async def test_reranker_fallback_has_a_context_limit(self):
        candidates = [
            {"url": f"https://example.com/{index}", "title": str(index), "content": "content"}
            for index in range(agent.RELATED_CONTEXT_RESULT_SIZE + 5)
        ]

        with patch.object(agent, "is_reranker_available", return_value=False):
            results = await agent._rerank_related_context("question", candidates)

        self.assertEqual(len(results), agent.RELATED_CONTEXT_RESULT_SIZE)

    async def test_reranking_limits_chunks_from_one_document_and_refills_results(self):
        candidates = [
            {
                "web_document_id": "same-document" if index < 5 else f"document-{index}",
                "chunk_index": index,
                "title": f"chunk-{index}",
                "content": "relevant",
                "rerank_score": 0.9,
            }
            for index in range(12)
        ]

        with patch.object(agent, "is_reranker_available", return_value=True), patch.object(
            agent,
            "rerank",
            new=AsyncMock(return_value=candidates),
        ):
            results = await agent._rerank_related_context("question", candidates)

        same_document_results = [item for item in results if item["web_document_id"] == "same-document"]
        self.assertEqual(len(results), agent.RELATED_CONTEXT_RESULT_SIZE)
        self.assertEqual(len(same_document_results), agent.MAX_CHUNKS_PER_DOCUMENT)

    async def test_explicit_collection_guarantees_only_top_low_scoring_results(self):
        candidates = [
            {
                "file_id": f"study-{index}",
                "chunk_index": index,
                "title": f"chunk-{index}",
                "content": "study evidence",
                "rerank_score": 0.01,
            }
            for index in range(3)
        ]

        with patch.object(agent, "is_reranker_available", return_value=True), patch.object(
            agent,
            "rerank",
            new=AsyncMock(return_value=candidates),
        ):
            results = await agent._rerank_related_context(
                "question",
                candidates,
                relevance_threshold=agent.COLLECTION_RERANK_SCORE_THRESHOLD,
                minimum_results=agent.COLLECTION_MIN_RESULTS,
            )

        self.assertEqual(len(results), agent.COLLECTION_MIN_RESULTS)
        self.assertEqual([item["chunk_index"] for item in results], [0, 1])


class RerankerPassageTests(unittest.TestCase):
    def test_warmup_uses_synthetic_passages_without_es_data(self):
        class FakeReranker:
            def __init__(self):
                self.calls = []

            def rank(self, query, passages, return_documents=False):
                self.calls.append((query, passages, return_documents))
                return []

        fake_reranker = FakeReranker()
        with patch.object(reranker, "_reranker", fake_reranker):
            self.assertTrue(reranker.warmup_reranker())

        self.assertEqual(len(fake_reranker.calls), 1)
        _, passages, return_documents = fake_reranker.calls[0]
        self.assertEqual(passages, list(reranker.RERANKER_WARMUP_PASSAGES))
        self.assertFalse(return_documents)

    def test_reranker_reads_beyond_the_first_four_hundred_characters(self):
        class FakeReranker:
            def __init__(self):
                self.passages = []

            def rank(self, query, passages, return_documents=False):
                self.passages = passages
                return [{"corpus_id": 0, "score": 0.9}]

        fake_reranker = FakeReranker()
        content = "a" * 500 + "answer-near-the-end"
        with patch.object(reranker, "_reranker", fake_reranker):
            reranker._rerank_sync(
                "answer",
                [{"title": "Guide", "heading_path": ["Setup"], "content": content}],
                top_k=1,
            )

        self.assertIn("answer-near-the-end", fake_reranker.passages[0])
        self.assertIn("Setup", fake_reranker.passages[0])


class EmbeddingIsolationTests(unittest.IsolatedAsyncioTestCase):
    async def test_failed_input_does_not_discard_other_embeddings(self):
        class FakeEmbeddingModel:
            def tokenize(self, value):
                return list(value)

            def detokenize(self, tokens):
                return bytes(tokens)

            def create_embedding(self, texts):
                if any(text == "bad" for text in texts):
                    raise RuntimeError("bad input")
                return {"data": [{"embedding": [1.0, 0.0]} for _ in texts]}

        with patch.object(embedding_runtime, "_load_model_sync", return_value=FakeEmbeddingModel()):
            embeddings = await embedding_runtime.get_embeddings(["good", "bad"])

        self.assertEqual(embeddings[0], [1.0, 0.0])
        self.assertIsNone(embeddings[1])


class CollectionQueryTests(unittest.TestCase):
    def test_collection_lexical_query_requires_relevance(self):
        query = indexer._filtered_lexical_query("file_id", ["file-1"], "target phrase")

        self.assertEqual(query["bool"]["minimum_should_match"], 1)
        self.assertEqual(query["bool"]["filter"], [{"terms": {"file_id": ["file-1"]}}])

    def test_language_search_also_checks_unknown_terms(self):
        self.assertEqual(
            indexer._language_search_indices("rag_documents", "ko"),
            ["rag_documents_ko", "rag_documents_und"],
        )


class ChatFileSearchTests(unittest.IsolatedAsyncioTestCase):
    async def test_vector_only_code_is_excluded_but_natural_language_is_kept(self):
        class FakeElasticsearch:
            def __init__(self):
                self.search_count = 0

            async def search(self, **kwargs):
                self.search_count += 1
                if self.search_count == 1:
                    return {"hits": {"hits": []}}
                return {"hits": {"hits": [
                    {
                        "_id": "code",
                        "_score": 0.9,
                        "_source": {
                            "filename": "module.py", "content": "def unrelated(): pass",
                            "source_name": "upload", "chunk_method": "whole_file",
                            "file_id": "code-file", "chunk_index": 0, "total_chunks": 1,
                        },
                    },
                    {
                        "_id": "document",
                        "_score": 0.8,
                        "_source": {
                            "filename": "guide.pdf", "content": "semantic answer",
                            "source_name": "upload", "chunk_method": "sliding_window_char",
                            "file_id": "document-file", "chunk_index": 0, "total_chunks": 1,
                        },
                    },
                ]}}

            async def close(self):
                return None

        fake_es = FakeElasticsearch()
        with patch.object(chat_file_index, "get_es", return_value=fake_es), patch.object(
            chat_file_index,
            "get_embedding",
            new=AsyncMock(return_value=[1.0, 0.0]),
        ):
            results = await chat_file_index.search_chat_files("conversation", "semantic question")

        self.assertEqual([result["file_id"] for result in results], ["document-file"])


if __name__ == "__main__":
    unittest.main()
