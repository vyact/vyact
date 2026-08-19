from collections import Counter

from services.language_level_test import (
    CEFR_LEVELS,
    CORE_CATEGORIES,
    SUPPORTED_LANGUAGES,
    TEST_LENGTHS,
    calculate_result,
    _estimate_level,
    load_question_bank,
    public_question,
    question_signature,
    select_next_question,
)


def test_every_language_has_a_balanced_300_question_bank():
    for language in SUPPORTED_LANGUAGES:
        bank = load_question_bank(language)
        assert len(bank) == 300
        assert len({question["id"] for question in bank}) == 300
        assert len({question_signature(question) for question in bank}) == 300
        assert Counter(question["level"] for question in bank) == {level: 60 for level in CEFR_LEVELS}
        assert set(question["category"] for question in bank) == set(CORE_CATEGORIES)
        assert len({question["type"] for question in bank}) >= 8
        assert {question["correctOptionId"] for question in bank} == {"A", "B", "C", "D"}
        for question in bank:
            assert question["correctOptionId"] in {option["id"] for option in question["options"]}
            assert len({option["text"] for option in question["options"]}) == 4
            assert "\n" not in question["instruction"]
            if question["type"] in {"CLOZE", "CLOZE_EXPRESSION"}:
                assert "___" in question["question"]
            if question["type"] == "PAIR_MATCH":
                assert question["question"] == ""


def test_public_question_never_exposes_answer_or_explanation():
    question = public_question(load_question_bank("en")[0], 1, 10)
    assert "correctOptionId" not in question
    assert "explanations" not in question
    assert question["sequence"] == 1
    assert question["total"] == 10


def test_adaptive_selector_does_not_repeat_questions():
    session = {
        "language": "ja",
        "testType": "QUICK",
        "currentEstimate": "A2",
        "questionIds": [],
        "answers": [],
    }
    selected_ids = set()
    selected_signatures = set()
    selected_groups = set()
    for _ in range(TEST_LENGTHS["QUICK"]):
        question = select_next_question(session)
        assert question["id"] not in selected_ids
        assert question_signature(question) not in selected_signatures
        assert question["contentGroupId"] not in selected_groups
        selected_ids.add(question["id"])
        selected_signatures.add(question_signature(question))
        selected_groups.add(question["contentGroupId"])
        session["questionIds"].append(question["id"])
        session["answers"].append({
            "questionId": question["id"], "level": question["level"],
            "category": question["category"], "correct": True,
        })


def test_detailed_selector_does_not_repeat_visible_prompts():
    for language in SUPPORTED_LANGUAGES:
        session = {
            "language": language,
            "testType": "DETAILED",
            "currentEstimate": "B1",
            "questionIds": [],
            "answers": [],
        }
        selected_signatures = set()
        selected_group_counts = Counter()
        for _ in range(TEST_LENGTHS["DETAILED"]):
            question = select_next_question(session)
            signature = question_signature(question)
            assert signature not in selected_signatures
            selected_signatures.add(signature)
            selected_group_counts[question["contentGroupId"]] += 1
            session["questionIds"].append(question["id"])
            session["answers"].append({
                "questionId": question["id"], "level": question["level"],
                "category": question["category"], "correct": True,
            })
        assert len(selected_group_counts) == TEST_LENGTHS["DETAILED"]
        assert max(selected_group_counts.values()) == 1


def test_detailed_result_contains_overall_and_all_categories():
    bank = load_question_bank("fr")[:30]
    session = {
        "testType": "DETAILED",
        "currentEstimate": "B1",
        "answers": [
            {"level": question["level"], "category": question["category"], "correct": index % 3 != 0}
            for index, question in enumerate(bank)
        ],
    }
    result = calculate_result(session)
    assert result["overall"] in CEFR_LEVELS
    assert set(result["categories"]) == set(CORE_CATEGORIES)
    assert result["answeredQuestions"] == 30
    assert result["accuracy"] == 0.67
    assert result["correctAnswers"] == 20


def test_all_unknown_answers_are_a1_with_zero_accuracy():
    bank = load_question_bank("en")[:30]
    session = {
        "testType": "DETAILED",
        "currentEstimate": "A1",
        "answers": [
            {
                "level": question["level"],
                "category": question["category"],
                "correct": False,
                "unknown": True,
            }
            for question in bank
        ],
    }

    result = calculate_result(session)

    assert result["overall"] == "A1"
    assert result["accuracy"] == 0.0
    assert result["correctAnswers"] == 0
    assert result["unknownAnswers"] == 30


def test_quick_test_can_reach_c1_when_started_from_a1():
    session = {
        "language": "ko",
        "testType": "QUICK",
        "currentEstimate": "A1",
        "questionIds": [],
        "answers": [],
    }
    for _ in range(TEST_LENGTHS["QUICK"]):
        question = select_next_question(session)
        session["questionIds"].append(question["id"])
        session["answers"].append({
            "questionId": question["id"],
            "level": question["level"],
            "category": question["category"],
            "correct": True,
            "unknown": False,
        })
        session["currentEstimate"] = _estimate_level(session["answers"], session["currentEstimate"])

    assert calculate_result(session)["overall"] == "C1"
