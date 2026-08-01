import unittest

from services.presentation_grounding import (
    add_source_notes,
    apply_page_repairs,
    audit_presentation,
    parse_json_object,
    validate_evidence_ledger,
)


class PresentationGroundingTests(unittest.TestCase):
    def setUp(self):
        self.context_docs = [{
            "title": "Launch memo",
            "content": "The pilot begins on 2027-03-15. The approved budget is USD 12 million.",
        }]
        self.ledger = validate_evidence_ledger({
            "facts": [
                {
                    "source_id": "S1",
                    "statement": "The pilot begins on 2027-03-15.",
                    "evidence": "The pilot begins on 2027-03-15.",
                },
                {
                    "source_id": "S1",
                    "statement": "The approved budget is USD 12 million.",
                    "evidence": "The approved budget is USD 12 million.",
                },
                {
                    "source_id": "S1",
                    "statement": "Unsupported invention",
                    "evidence": "This excerpt does not exist.",
                },
            ]
        }, self.context_docs)

    def test_markdown_json_is_parsed(self):
        self.assertEqual(parse_json_object('```json\n{"facts": []}\n```'), {"facts": []})

    def test_json_with_model_preamble_is_parsed(self):
        self.assertEqual(
            parse_json_object('Here is the requested JSON:\n{"facts": []}\nDone.'),
            {"facts": []},
        )

    def test_only_verbatim_evidence_is_verified(self):
        self.assertEqual([fact["id"] for fact in self.ledger["facts"]], ["F1", "F2"])

    def test_unsupported_number_is_reported(self):
        deck = {"pages": [
            {"title": "Cover"},
            {"title": "Budget", "content": "Budget is USD 21 million.", "fact_ids": ["F2"]},
            {"title": "Close"},
        ]}
        findings = audit_presentation(deck, self.ledger, "en")
        self.assertIn("unsupported_fact_tokens", {finding["code"] for finding in findings})

    def test_language_mismatch_is_reported(self):
        deck = {"pages": [
            {"title": "Cover"},
            {"title": "잘못된 언어", "content": "이 페이지는 선택한 영어가 아니라 한국어로 작성되었습니다."},
            {"title": "Close"},
        ]}
        findings = audit_presentation(deck, self.ledger, "en")
        self.assertIn("language_mismatch", {finding["code"] for finding in findings})

    def test_repairs_are_bounded_to_requested_page(self):
        deck = {"pages": [{"title": "Cover"}, {"title": "Old"}, {"title": "Close"}]}
        repaired = apply_page_repairs(deck, {
            "repaired_pages": [{"index": 1, "page": {"title": "New", "fact_ids": ["F1"]}}]
        })
        self.assertEqual(repaired["pages"][0]["title"], "Cover")
        self.assertEqual(repaired["pages"][1]["title"], "New")
        self.assertEqual(repaired["pages"][2]["title"], "Close")

    def test_source_notes_are_human_readable(self):
        deck = {"pages": [{"title": "Timeline", "fact_ids": ["F1"]}]}
        prepared = add_source_notes(deck, self.ledger, "ko")
        notes = prepared["pages"][0]["speaker_notes"]
        self.assertIn("[근거 출처]", notes)
        self.assertIn("Launch memo", notes)
        self.assertIn("2027-03-15", notes)


if __name__ == "__main__":
    unittest.main()
