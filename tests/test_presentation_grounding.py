import unittest

from prompts import build_system_message
from services.presentation_grounding import (
    add_source_notes,
    apply_page_repairs,
    audit_presentation,
    extract_numbered_outline,
    parse_json_object,
    reconcile_page_fact_ids,
    repair_unsupported_fact_tokens,
    sanitize_presentation_content,
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

    def test_isolated_system_prompt_has_no_global_context(self):
        message = build_system_message(
            "presentation contract",
            None,
            user_profile="profile that must not leak",
            skill_context="skill that must not leak",
            conversation_summary="summary that must not leak",
            user_language="ko",
            isolated=True,
        )
        self.assertEqual(message, "presentation contract")

    def test_json_with_model_preamble_is_parsed(self):
        self.assertEqual(
            parse_json_object('Here is the requested JSON:\n{"facts": []}\nDone.'),
            {"facts": []},
        )

    def test_visible_latex_and_fact_markers_are_sanitized(self):
        deck = {
            "presentation_title": "Roadmap $\\to$ Action",
            "pages": [{
                "title": "KRW 15B $\\to$ KRW 20B [F8, F30]",
                "stats": [{"value": "15 -> 10", "label": "Threshold"}],
                "speaker_notes": "Keep $\\to$ in the source quotation.",
            }],
        }
        prepared = sanitize_presentation_content(deck)
        self.assertEqual(prepared["presentation_title"], "Roadmap → Action")
        self.assertEqual(prepared["pages"][0]["title"], "KRW 15B → KRW 20B")
        self.assertEqual(prepared["pages"][0]["stats"][0]["value"], "15 → 10")
        self.assertIn("$\\to$", prepared["pages"][0]["speaker_notes"])

    def test_complex_latex_is_converted_without_raw_tokens(self):
        deck = {
            "pages": [{
                "title": r"$\frac{\alpha + x^{2}}{\sqrt[3]{y_1}} \approx 10$",
                "content": r"\textbf{Result}: \begin{matrix}a & b \\ c & d\end{matrix}",
            }],
        }
        prepared = sanitize_presentation_content(deck)
        visible = prepared["pages"][0]["title"] + prepared["pages"][0]["content"]
        self.assertIn("α", visible)
        self.assertIn("3√", visible)
        self.assertIn("≈", visible)
        self.assertNotIn("\\", visible)
        self.assertNotIn("$", visible)
        self.assertNotIn("{", visible)

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

    def test_same_digits_with_different_explicit_units_are_rejected(self):
        context = [{"title": "Budget", "content": "기준은 150억원입니다."}]
        ledger = validate_evidence_ledger({"facts": [{
            "source_id": "S1",
            "statement": "기준은 150억원입니다.",
            "evidence": "기준은 150억원입니다.",
        }]}, context)
        deck = {"pages": [{
            "title": "Threshold",
            "content": "The threshold is KRW 150M.",
            "fact_ids": ["F1"],
        }]}
        findings = audit_presentation(deck, ledger, "en")
        unsupported = next(
            finding for finding in findings
            if finding["code"] == "unsupported_fact_tokens"
        )
        self.assertIn("150m", unsupported["details"])

    def test_page_unit_cannot_be_inferred_from_bare_evidence_number(self):
        context = [{"title": "Threshold", "content": "The threshold changes from 150 to 200억원."}]
        ledger = validate_evidence_ledger({"facts": [{
            "source_id": "S1",
            "statement": "The threshold changes from 150 to 200억원.",
            "evidence": "The threshold changes from 150 to 200억원.",
        }]}, context)
        deck = {"pages": [{
            "title": "Threshold",
            "content": "The threshold starts at 150B KRW.",
            "fact_ids": ["F1"],
        }]}
        findings = audit_presentation(deck, ledger, "en")
        unsupported = next(
            finding for finding in findings
            if finding["code"] == "unsupported_fact_tokens"
        )
        self.assertIn("150bkrw", unsupported["details"])

        repaired = repair_unsupported_fact_tokens(deck, ledger, findings)
        self.assertEqual(repaired["pages"][0]["content"], "The threshold starts at 150.")
        self.assertEqual(audit_presentation(repaired, ledger, "en"), [])

    def test_equivalent_currency_units_are_supported(self):
        context = [{"title": "Price", "content": "주가 1,000원 미만입니다."}]
        ledger = validate_evidence_ledger({"facts": [{
            "source_id": "S1",
            "statement": "주가 1,000원 미만입니다.",
            "evidence": "주가 1,000원 미만입니다.",
        }]}, context)
        deck = {"pages": [{
            "title": "Penny stock threshold",
            "content": "The price is below 1,000 KRW.",
            "fact_ids": ["F1"],
        }]}
        self.assertEqual(audit_presentation(deck, ledger, "en"), [])

    def test_equivalent_date_formats_are_supported(self):
        context = [{"title": "Schedule", "content": "시행 시점은 ‘26.7월이며 다음 단계는 2027년 1월입니다."}]
        ledger = validate_evidence_ledger({"facts": [{
            "source_id": "S1",
            "statement": "시행 시점은 ‘26.7월이며 다음 단계는 2027년 1월입니다.",
            "evidence": "시행 시점은 ‘26.7월이며 다음 단계는 2027년 1월입니다.",
        }]}, context)
        deck = {"pages": [{
            "title": "Schedule",
            "content": "July '26, then 2027.1.",
            "fact_ids": ["F1"],
        }]}
        self.assertEqual(audit_presentation(deck, ledger, "en"), [])

    def test_numbered_outline_is_extracted(self):
        prompt = "소개 문장\n1. 표지와 핵심 메시지\n2) 정책 영향 비교\n마무리"
        self.assertEqual(
            extract_numbered_outline(prompt),
            ["표지와 핵심 메시지", "정책 영향 비교"],
        )

    def test_number_without_source_unit_is_reconciled(self):
        context = [{"title": "Scope memo", "content": "The program covers approximately 220 companies."}]
        ledger = validate_evidence_ledger({"facts": [{
            "source_id": "S1",
            "statement": "The program covers approximately 220 companies.",
            "evidence": "approximately 220 companies",
        }]}, context)
        deck = {"pages": [
            {"title": "Cover", "fact_ids": []},
            {"title": "Scope", "content": "Maximum scope: 220", "fact_ids": []},
            {"title": "Close", "fact_ids": []},
        ]}
        prepared = reconcile_page_fact_ids(deck, ledger)
        self.assertEqual(prepared["pages"][1]["fact_ids"], ["F1"])
        self.assertEqual(audit_presentation(prepared, ledger, "en"), [])

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
