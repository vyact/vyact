from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from services import language_learning_profile


class FakeElasticsearch:
    def __init__(self):
        self.index = AsyncMock()
        self.close = AsyncMock()


@pytest.mark.asyncio
async def test_get_learning_profiles_does_not_connect_before_setup(monkeypatch, tmp_path):
    setup_done = tmp_path / ".setup_done"
    get_es = AsyncMock()
    monkeypatch.setattr(language_learning_profile, "SETUP_DONE", setup_done)
    monkeypatch.setattr(language_learning_profile, "get_es", get_es)

    profiles = await language_learning_profile.get_learning_profiles()

    assert profiles == {
        language: None for language in language_learning_profile.SUPPORTED_LANGUAGES
    }
    get_es.assert_not_called()


@pytest.mark.asyncio
async def test_set_learning_focus_deduplicates_areas(monkeypatch, tmp_path):
    elasticsearch = FakeElasticsearch()
    setup_done = tmp_path / ".setup_done"
    setup_done.touch()
    monkeypatch.setattr(language_learning_profile, "SETUP_DONE", setup_done)
    monkeypatch.setattr(language_learning_profile, "get_es", lambda: elasticsearch)

    profile = await language_learning_profile.set_learning_focus(
        "en", ["chunks_idioms", "phrasal_verbs", "chunks_idioms"]
    )

    assert profile == {
        "language": "en",
        "learningFocusAreas": ["chunks_idioms", "phrasal_verbs"],
    }
    elasticsearch.index.assert_awaited_once()
    elasticsearch.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_set_learning_focus_rejects_unknown_area(monkeypatch, tmp_path):
    elasticsearch = FakeElasticsearch()
    setup_done = tmp_path / ".setup_done"
    setup_done.touch()
    monkeypatch.setattr(language_learning_profile, "SETUP_DONE", setup_done)
    monkeypatch.setattr(language_learning_profile, "get_es", lambda: elasticsearch)

    with pytest.raises(HTTPException) as error:
        await language_learning_profile.set_learning_focus("en", ["unknown"])

    assert error.value.status_code == 400
    elasticsearch.index.assert_not_awaited()
