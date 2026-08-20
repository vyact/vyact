"""언어별 자막 학습 포커스 프로필 저장소."""

from fastapi import HTTPException

from services.db import get_es


SUPPORTED_LANGUAGES = ("ko", "en", "ja", "zh", "th", "vi", "es", "fr")
LEARNING_FOCUS_AREAS = (
    "chunks_idioms",
    "phrasal_verbs",
    "contractions_reduced_speech",
    "tenses_modals",
    "sentence_structure",
    "nuance_context",
)
PROFILE_INDEX = "language_learning_focus_profiles"


async def ensure_language_learning_profile_index() -> None:
    es = get_es()
    try:
        if not await es.indices.exists(index=PROFILE_INDEX):
            await es.indices.create(index=PROFILE_INDEX, mappings={"properties": {
                "language": {"type": "keyword"},
                "learningFocusAreas": {"type": "keyword"},
            }})
    finally:
        await es.close()


async def get_learning_profiles() -> dict:
    es = get_es()
    try:
        response = await es.mget(index=PROFILE_INDEX, ids=list(SUPPORTED_LANGUAGES))
        return {
            language: document.get("_source") if document.get("found") else None
            for language, document in zip(SUPPORTED_LANGUAGES, response.get("docs", []))
        }
    finally:
        await es.close()


async def set_learning_focus(language: str, focus_areas: list[str]) -> dict:
    if language not in SUPPORTED_LANGUAGES:
        raise HTTPException(status_code=400, detail="Unsupported learning language")
    normalized_focus_areas = list(dict.fromkeys(focus_areas))
    if set(normalized_focus_areas) - set(LEARNING_FOCUS_AREAS):
        raise HTTPException(status_code=400, detail="Unsupported learning focus area")

    profile = {"language": language, "learningFocusAreas": normalized_focus_areas}
    es = get_es()
    try:
        await es.index(index=PROFILE_INDEX, id=language, document=profile, refresh=True)
        return profile
    finally:
        await es.close()
