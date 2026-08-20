"""언어별 자막 학습 포커스 API."""

from fastapi import APIRouter
from pydantic import BaseModel, Field

from services.language_learning_profile import get_learning_profiles, set_learning_focus


router = APIRouter()


class LearningFocusRequest(BaseModel):
    focus_areas: list[str] = Field(alias="focusAreas")


@router.get("/language-learning-profiles")
async def list_language_learning_profiles():
    return {"profiles": await get_learning_profiles()}


@router.put("/language-learning-profiles/{language}/focus")
async def update_learning_focus(language: str, request: LearningFocusRequest):
    return {"profile": await set_learning_focus(language, request.focus_areas)}
