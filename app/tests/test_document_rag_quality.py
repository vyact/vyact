import unittest

from services.document_parser import _classify_text_lines_with_context
from services.indexer import _rerank


class PdfChunkingQualityTests(unittest.TestCase):
    def test_blank_lines_from_pdf_layout_do_not_create_tiny_paragraphs(self):
        chunks = _classify_text_lines_with_context(
            "First line of the same paragraph.\n\nSecond line of the same paragraph.",
            [],
            1,
        )

        self.assertEqual(len(chunks), 1)
        self.assertIn("First line", chunks[0].text)
        self.assertIn("Second line", chunks[0].text)

    def test_academic_prose_starting_with_if_is_not_classified_as_code(self):
        chunks = _classify_text_lines_with_context(
            "If these shares exist prior to going public, governance changes.",
            [],
            2,
        )

        self.assertEqual(chunks[0].chunk_type, "paragraph")

    def test_retrieval_result_preserves_document_location_metadata(self):
        results = _rerank([{
            "_id": "chunk",
            "_score": 1.0,
            "_source": {
                "title": "paper.pdf [3/10]",
                "content": "answer",
                "source": "문서(PDF)",
                "file_id": "file",
                "chunk_index": 2,
                "total_chunks": 10,
                "chunk_type": "paragraph",
                "page_number": 4,
            },
        }], 1)

        self.assertEqual(results[0]["page_number"], 4)
        self.assertEqual(results[0]["total_chunks"], 10)


if __name__ == "__main__":
    unittest.main()
