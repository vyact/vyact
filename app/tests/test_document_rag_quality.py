import unittest
from pathlib import Path
from unittest.mock import patch

from services import document_parser
from services.document_parser import Chunk, _classify_text_lines_with_context
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

    def test_pdf_indexing_reuses_single_parse_result(self):
        parsed = ([Chunk("body", "paragraph", [], 1)], "original body")
        with patch.object(document_parser, "_parse_pdf_content", return_value=parsed) as parse_pdf:
            chunks, original = document_parser.parse_file_for_indexing(Path("paper.pdf"))

        parse_pdf.assert_called_once()
        self.assertEqual(chunks[0].text, "body")
        self.assertEqual(original, "original body")

    def test_xlsx_indexing_reuses_typed_chunks_for_original_text(self):
        chunks = [Chunk("[시트: Sheet1]\nheader\nvalue", "table")]
        with patch.object(document_parser, "parse_file_to_typed_chunks", return_value=chunks), patch.object(
            document_parser,
            "parse_file",
        ) as parse_file:
            _, original = document_parser.parse_file_for_indexing(Path("book.xlsx"))

        parse_file.assert_not_called()
        self.assertEqual(original, chunks[0].text)


if __name__ == "__main__":
    unittest.main()
