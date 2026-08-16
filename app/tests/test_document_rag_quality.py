import unittest

from services.document_parser import _classify_text_lines_with_context


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


if __name__ == "__main__":
    unittest.main()
