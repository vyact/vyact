"""공통 다국어 CEFR 레벨 테스트 엔진과 저장소."""

import json
import random
import uuid
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path

from fastapi import HTTPException

from services.db import get_es


SUPPORTED_LANGUAGES = ("ko", "en", "ja", "zh", "th", "vi", "es", "fr")
CEFR_LEVELS = ("A1", "A2", "B1", "B2", "C1")
CORE_CATEGORIES = (
    "VOCABULARY",
    "SENTENCE_STRUCTURE",
    "GRAMMAR",
    "COLLOCATION",
    "NATURAL_EXPRESSION",
    "READING",
    "LISTENING",
)
TEST_LENGTHS = {"QUICK": 10, "DETAILED": 30}
QUESTION_BANK_DIR = Path(__file__).resolve().parent.parent / "question_banks"
SESSION_INDEX = "language_test_sessions"
PROFILE_INDEX = "language_learning_profiles"
RESULT_INDEX = "language_test_results"
QUESTION_BANK_VERSION = 7

QUICK_CATEGORY_TARGETS = {
    "VOCABULARY": 2,
    "SENTENCE_STRUCTURE": 2,
    "GRAMMAR": 2,
    "COLLOCATION": 1,
    "NATURAL_EXPRESSION": 1,
    "READING": 2,
}
DETAILED_CATEGORY_TARGETS = {
    "VOCABULARY": 4,
    "SENTENCE_STRUCTURE": 4,
    "GRAMMAR": 4,
    "COLLOCATION": 4,
    "NATURAL_EXPRESSION": 4,
    "READING": 6,
    "LISTENING": 4,
}
CATEGORY_WEIGHTS = {
    "VOCABULARY": 0.15,
    "SENTENCE_STRUCTURE": 0.15,
    "GRAMMAR": 0.15,
    "COLLOCATION": 0.10,
    "NATURAL_EXPRESSION": 0.10,
    "READING": 0.20,
    "LISTENING": 0.15,
}

_question_cache: dict[str, tuple[int, list[dict]]] = {}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def load_question_bank(language: str) -> list[dict]:
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported test language")
    bank_path = QUESTION_BANK_DIR / f"{language}.jsonl"
    if not bank_path.exists():
        raise HTTPException(status_code=503, detail="Question bank is unavailable")
    modified_at = bank_path.stat().st_mtime_ns
    cached = _question_cache.get(language)
    if cached and cached[0] == modified_at:
        return cached[1]
    questions = [json.loads(line) for line in bank_path.read_text(encoding="utf-8").splitlines() if line.strip()]
    active_questions = [question for question in questions if question.get("status") == "ACTIVE"]
    _question_cache[language] = (modified_at, active_questions)
    return active_questions


def public_question(question: dict, sequence: int, total: int) -> dict:
    return {
        "id": question["id"],
        "sequence": sequence,
        "total": total,
        "level": question["level"],
        "category": question["category"],
        "languageSpecificCategory": question.get("languageSpecificCategory"),
        "type": question["type"],
        "instruction": question.get("instruction", ""),
        "stimulus": question.get("stimulus"),
        "question": question["question"],
        "options": question["options"],
        "estimatedSeconds": question.get("estimatedSeconds", 20),
    }


def _level_index(level: str) -> int:
    return CEFR_LEVELS.index(level)


def question_signature(question: dict) -> str:
    """ID나 Category가 달라도 사용자에게 같은 문제로 보이면 동일하게 취급한다."""
    prompt = question.get("stimulus") or question.get("question") or ""
    if not prompt:
        prompt = " | ".join(option["text"] for option in question.get("options", []))
    return " ".join(f"{question.get('instruction', '')} {prompt}".casefold().split())


def _target_category(test_type: str, answers: list[dict]) -> str:
    targets = QUICK_CATEGORY_TARGETS if test_type == "QUICK" else DETAILED_CATEGORY_TARGETS
    answered_counts = defaultdict(int)
    for answer in answers:
        answered_counts[answer["category"]] += 1
    return max(targets, key=lambda category: (targets[category] - answered_counts[category]) / targets[category])


def _estimate_level(answers: list[dict], initial_level: str) -> str:
    estimate = _level_index(initial_level)
    if len(answers) >= 2:
        recent = answers[-2:]
        if all(answer["correct"] for answer in recent):
            estimate += 1
        elif not any(answer["correct"] for answer in recent):
            estimate -= 1
    return CEFR_LEVELS[max(0, min(len(CEFR_LEVELS) - 1, estimate))]


def select_next_question(session: dict, previous_question_ids: set[str] | None = None) -> dict:
    bank = load_question_bank(session["language"])
    used_ids = set(session["questionIds"])
    used_signatures = {
        question_signature(question)
        for question in bank
        if question["id"] in used_ids
    }
    previous_ids = previous_question_ids or set(session.get("previousQuestionIds", []))
    previous_signatures = set(session.get("previousQuestionSignatures", []))
    category = _target_category(session["testType"], session["answers"])
    estimate_index = _level_index(session["currentEstimate"])
    eligible_questions = [
        question for question in bank
        if question["id"] not in used_ids
        and question_signature(question) not in used_signatures
    ]
    used_group_ids = {
        question.get("contentGroupId", question_signature(question))
        for question in bank
        if question["id"] in used_ids
    }
    candidates = [
        question for question in eligible_questions
        if question["category"] == category
        and question.get("contentGroupId", question_signature(question)) not in used_group_ids
    ]
    if not candidates:
        candidates = [
            question for question in eligible_questions
            if question.get("contentGroupId", question_signature(question)) not in used_group_ids
        ]
    if not candidates:
        raise HTTPException(status_code=409, detail="No unused question concepts are available")

    def selection_score(question: dict) -> float:
        distance = abs(_level_index(question["level"]) - estimate_index)
        difficulty_match = max(0.0, 1.0 - distance * 0.35)
        seen_before = question["id"] in previous_ids or question_signature(question) in previous_signatures
        unseen_priority = 0.0 if seen_before else 1.0
        quality_score = float(question.get("quality", {}).get("score", 1.0))
        return difficulty_match * 0.55 + unseen_priority * 0.25 + quality_score * 0.15 + random.random() * 0.05

    return max(candidates, key=selection_score)


def calculate_result(session: dict) -> dict:
    answers = session["answers"]
    correct_count = sum(1 for answer in answers if answer["correct"])
    unknown_count = sum(1 for answer in answers if answer.get("unknown"))
    category_answers: dict[str, list[dict]] = defaultdict(list)
    for answer in answers:
        category_answers[answer["category"]].append(answer)

    category_results = {}
    for category in CORE_CATEGORIES:
        items = category_answers.get(category, [])
        if not items:
            category_results[category] = {"level": None, "confidence": 0.0, "answeredQuestions": 0}
            continue
        evidence = sum(
            _level_index(item["level"])
            + (0.55 if item["correct"] else -0.75 if item.get("unknown") else -0.55)
            for item in items
        ) / len(items)
        level_index = max(0, min(len(CEFR_LEVELS) - 1, round(evidence)))
        accuracy = sum(1 for item in items if item["correct"]) / len(items)
        expected_count = DETAILED_CATEGORY_TARGETS.get(category, 4)
        confidence = min(0.95, (len(items) / expected_count) * (0.55 + abs(accuracy - 0.5) * 0.8))
        category_results[category] = {
            "level": CEFR_LEVELS[level_index],
            "confidence": round(confidence, 2),
            "answeredQuestions": len(items),
        }
    # Later questions are targeted using the responses already observed, so they
    # provide stronger evidence than the initial routing questions. The saved
    # level selects only the starting difficulty and is not included directly.
    response_weight_total = sum(range(1, len(answers) + 1))
    weighted_evidence = sum(
        sequence * (
            _level_index(answer["level"])
            + (0.55 if answer["correct"] else -0.75 if answer.get("unknown") else -0.55)
        )
        for sequence, answer in enumerate(answers, start=1)
    )
    overall_index = round(weighted_evidence / response_weight_total) if response_weight_total else _level_index(session["currentEstimate"])
    overall_index = max(0, min(len(CEFR_LEVELS) - 1, overall_index))
    overall_confidence = min(0.95, 0.45 + len(answers) / TEST_LENGTHS[session["testType"]] * 0.4)
    return {
        "overall": CEFR_LEVELS[overall_index],
        "confidence": round(overall_confidence, 2),
        "accuracy": round(correct_count / len(answers), 2) if answers else 0.0,
        "correctAnswers": correct_count,
        "unknownAnswers": unknown_count,
        "testType": session["testType"],
        "isApproximate": session["testType"] == "QUICK",
        "categories": category_results,
        "answeredQuestions": len(answers),
    }


async def ensure_language_test_indices() -> None:
    es = get_es()
    definitions = {
        SESSION_INDEX: {
            "sessionId": {"type": "keyword"}, "language": {"type": "keyword"},
            "testType": {"type": "keyword"}, "status": {"type": "keyword"},
            "startedAt": {"type": "date"}, "completedAt": {"type": "date"},
            "payload": {"type": "object", "enabled": False},
        },
        PROFILE_INDEX: {
            "language": {"type": "keyword"}, "overall": {"type": "keyword"},
            "sourceTestType": {"type": "keyword"}, "testedAt": {"type": "date"},
            "payload": {"type": "object", "enabled": False},
        },
        RESULT_INDEX: {
            "sessionId": {"type": "keyword"}, "language": {"type": "keyword"},
            "overall": {"type": "keyword"}, "testType": {"type": "keyword"},
            "testedAt": {"type": "date"}, "payload": {"type": "object", "enabled": False},
        },
    }
    try:
        for index, properties in definitions.items():
            if not await es.indices.exists(index=index):
                await es.indices.create(index=index, mappings={"properties": properties})
    finally:
        await es.close()


async def get_profiles() -> dict:
    es = get_es()
    try:
        response = await es.mget(index=PROFILE_INDEX, ids=list(SUPPORTED_LANGUAGES))
        profiles = {}
        for language, document in zip(SUPPORTED_LANGUAGES, response.get("docs", [])):
            profiles[language] = document.get("_source", {}).get("payload") if document.get("found") else None
        latest_results = await es.search(
            index=RESULT_INDEX,
            query={"match_all": {}},
            sort=[{"testedAt": {"order": "desc"}}],
            size=1000,
        )
        for hit in latest_results.get("hits", {}).get("hits", []):
            result = hit.get("_source", {}).get("payload") or {}
            language = result.get("language")
            if language not in profiles:
                continue
            profile = profiles.get(language) or {}
            if not profile.get("testedAt") or result.get("testedAt", "") > profile["testedAt"]:
                profiles[language] = {
                    **profile,
                    **result,
                    "sourceTestType": result.get("testType"),
                }
        return profiles
    finally:
        await es.close()


async def create_session(language: str, test_type: str) -> tuple[dict, dict]:
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported test language")
    if test_type not in TEST_LENGTHS:
        raise HTTPException(status_code=400, detail="Unsupported test type")
    profiles = await get_profiles()
    previous_profile = profiles.get(language) or {}
    initial_level = previous_profile.get("overall", "A2")
    session = {
        "sessionId": uuid.uuid4().hex,
        "language": language,
        "testType": test_type,
        "questionBankVersion": QUESTION_BANK_VERSION,
        "status": "ACTIVE",
        "initialLevel": initial_level,
        "currentEstimate": initial_level,
        "questionIds": [],
        "previousQuestionIds": previous_profile.get("recentQuestionIds", []),
        "previousQuestionSignatures": previous_profile.get("recentQuestionSignatures", []),
        "answers": [],
        "startedAt": utc_now(),
        "completedAt": None,
    }
    question = select_next_question(session)
    session["questionIds"].append(question["id"])
    es = get_es()
    try:
        await es.index(index=SESSION_INDEX, id=session["sessionId"], document={
            "sessionId": session["sessionId"], "language": language, "testType": test_type,
            "status": "ACTIVE", "startedAt": session["startedAt"], "payload": session,
        }, refresh=True)
    finally:
        await es.close()
    return session, public_question(question, 1, TEST_LENGTHS[test_type])


async def answer_session(session_id: str, question_id: str, option_id: str) -> dict:
    es = get_es()
    try:
        response = await es.get(index=SESSION_INDEX, id=session_id)
        session = response["_source"]["payload"]
        if session["status"] != "ACTIVE":
            raise HTTPException(status_code=409, detail="Test session is already complete")
        if session.get("questionBankVersion") != QUESTION_BANK_VERSION:
            raise HTTPException(status_code=409, detail="Question bank was updated; start a new test")
        if not session["questionIds"] or session["questionIds"][-1] != question_id:
            raise HTTPException(status_code=409, detail="Question does not match active session")
        question = next((item for item in load_question_bank(session["language"]) if item["id"] == question_id), None)
        if question is None:
            raise HTTPException(status_code=404, detail="Question not found")
        if any(answer["questionId"] == question_id for answer in session["answers"]):
            raise HTTPException(status_code=409, detail="Question was already answered")
        unknown = option_id == "__UNKNOWN__"
        correct = not unknown and option_id == question["correctOptionId"]
        session["answers"].append({
            "questionId": question_id, "optionId": option_id, "correct": correct,
            "unknown": unknown, "level": question["level"], "category": question["category"],
        })
        session["currentEstimate"] = _estimate_level(session["answers"], session["currentEstimate"])
        total = TEST_LENGTHS[session["testType"]]
        if len(session["answers"]) >= total:
            result = calculate_result(session)
            session["status"] = "COMPLETED"
            session["completedAt"] = utc_now()
            result.update({"language": session["language"], "testedAt": session["completedAt"], "sessionId": session_id})
            await _save_completed_test(es, session, result)
            return {"complete": True, "correct": correct, "explanation": question.get("explanations", {}), "result": result}
        next_question = select_next_question(session)
        session["questionIds"].append(next_question["id"])
        await _save_session(es, session)
        return {
            "complete": False,
            "correct": correct,
            "explanation": question.get("explanations", {}),
            "question": public_question(next_question, len(session["answers"]) + 1, total),
        }
    except HTTPException:
        raise
    except Exception as error:
        if getattr(error, "status_code", None) == 404:
            raise HTTPException(status_code=404, detail="Test session not found") from error
        raise
    finally:
        await es.close()


async def _save_session(es, session: dict) -> None:
    await es.index(index=SESSION_INDEX, id=session["sessionId"], document={
        "sessionId": session["sessionId"], "language": session["language"],
        "testType": session["testType"], "status": session["status"],
        "startedAt": session["startedAt"], "completedAt": session["completedAt"], "payload": session,
    }, refresh=True)


async def _save_completed_test(es, session: dict, result: dict) -> None:
    await _save_session(es, session)
    await es.index(index=RESULT_INDEX, id=session["sessionId"], document={
        "sessionId": session["sessionId"], "language": session["language"],
        "overall": result["overall"], "testType": session["testType"],
        "testedAt": result["testedAt"], "payload": result,
    })
    current_profile = None
    try:
        current_profile = (await es.get(index=PROFILE_INDEX, id=session["language"]))["_source"]["payload"]
    except Exception as error:
        if getattr(error, "status_code", None) != 404:
            raise
    profile = {
            "language": session["language"], "overall": result["overall"],
            "confidence": result["confidence"], "categories": result["categories"],
            "sourceTestType": session["testType"], "testedAt": result["testedAt"],
            "recentQuestionIds": list(dict.fromkeys([
                *session.get("questionIds", []),
                *(current_profile or {}).get("recentQuestionIds", []),
            ]))[:200],
            "recentQuestionSignatures": list(dict.fromkeys([
                *(question_signature(question) for question in load_question_bank(session["language"])
                  if question["id"] in session.get("questionIds", [])),
                *(current_profile or {}).get("recentQuestionSignatures", []),
            ]))[:200],
    }
    await es.index(index=PROFILE_INDEX, id=session["language"], document={
        "language": session["language"], "overall": profile["overall"],
        "sourceTestType": profile["sourceTestType"], "testedAt": profile["testedAt"],
        "payload": profile,
    }, refresh=True)
