"""다국어 CEFR 레벨 테스트 API."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.language_level_test import answer_session, create_session, get_profiles, set_explanation_level


router = APIRouter()


class TestStartRequest(BaseModel):
    language: str
    test_type: str = Field(alias="testType")


class TestAnswerRequest(BaseModel):
    question_id: str = Field(alias="questionId")
    option_id: str = Field(alias="optionId")


class ExplanationLevelRequest(BaseModel):
    explanation_level: str | None = Field(default=None, alias="explanationLevel")


@router.get("/language-levels")
async def list_language_levels():
    return {"profiles": await get_profiles()}


@router.put("/language-levels/{language}/explanation-level")
async def update_explanation_level(language: str, request: ExplanationLevelRequest):
    normalized_level = request.explanation_level.upper() if request.explanation_level else None
    return {"profile": await set_explanation_level(language, normalized_level)}


@router.post("/language-tests")
async def start_language_test(request: TestStartRequest):
    session, question = await create_session(request.language, request.test_type.upper())
    return {"sessionId": session["sessionId"], "question": question}


@router.post("/language-tests/{session_id}/answers")
async def submit_language_test_answer(session_id: str, request: TestAnswerRequest):
    return await answer_session(session_id, request.question_id, request.option_id)
