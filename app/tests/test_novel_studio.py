from unittest.mock import AsyncMock, patch
from uuid import uuid4
from elasticsearch import NotFoundError
from services.db import NOVEL_STORIES_INDEX, ensure_novel_stories_index
from routers.novel_studio import NovelChapter, NovelStory, save_novel_story, list_novel_stories, delete_novel_story

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers.novel_studio import NovelGenerationRequest, generate_novel


@pytest.mark.asyncio
async def test_generation_includes_continuity_and_uses_configured_model_without_tools():
    body = NovelGenerationRequest(title="Library", bible="Seo is the librarian", previous="The door closed", manuscript="A knock", instruction="Continue", language="ko")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value=" New scene ")) as model:
        assert await generate_novel(body) == {"text": "New scene"}
    prompt = model.call_args.args[0]
    assert all(value in prompt for value in [body.bible, body.previous, body.manuscript, body.instruction, body.language])
    assert model.call_args.kwargs["use_tools"] is False
    assert model.call_args.kwargs["inject_user_profile"] is False


@pytest.mark.asyncio
async def test_blank_instruction_does_not_call_model():
    body = NovelGenerationRequest(title="", bible="", previous="", manuscript="", instruction="  ")
    with patch("routers.novel_studio.query_llm", new=AsyncMock()) as model:
        with pytest.raises(HTTPException) as error:
            await generate_novel(body)
    assert error.value.status_code == 400
    model.assert_not_called()


def test_context_limits_reject_oversized_requests():
    with pytest.raises(ValidationError):
        NovelGenerationRequest(title="", bible="x" * 20001, previous="", manuscript="", instruction="Continue")


@pytest.mark.asyncio
async def test_story_settings_request_generates_notes_instead_of_manuscript():
    body = NovelGenerationRequest(title="Library", bible="The librarian is Seo", previous="", manuscript="", instruction="Develop characters", target="bible")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value="Character: Seo")) as model:
        assert await generate_novel(body) == {"text": "Character: Seo"}
    assert "Develop story settings, not manuscript prose" in model.call_args.args[2]
    assert "The librarian is Seo" in model.call_args.args[0]


@pytest.mark.asyncio
async def test_story_save_targets_dedicated_index_and_preserves_creation_time():

    story = NovelStory(id=uuid4(), title="밤의 도서관", bible="서윤은 사서다", chapters=[NovelChapter(id=uuid4(), title="제1화", text="문이 열렸다")])
    es = AsyncMock()
    with patch("routers.novel_studio.get_es", return_value=es), patch("routers.novel_studio.ensure_novel_stories_index", new=AsyncMock()):
        assert await save_novel_story(story.id, story) == {"ok": True}
    call = es.update.call_args.kwargs
    assert call["index"] == NOVEL_STORIES_INDEX == "novel_stories"
    assert call["id"] == str(story.id)
    assert call["script"]["params"]["story"]["chapters"][0]["text"] == "문이 열렸다"
    assert "created_at" in call["script"]["source"]
    assert call["refresh"] == "wait_for"
    es.close.assert_awaited_once()


@pytest.mark.asyncio
async def test_listing_paginates_and_preserves_all_chapters():

    es = AsyncMock()
    full_page = [{"_source": {"id": str(index), "chapters": [], "created_at": "2026"}, "sort": [str(index)]} for index in range(100)]
    final_story = {"id": "last", "chapters": [{"text": "Final chapter"}], "created_at": "2027"}
    es.search.side_effect = [{"hits": {"hits": full_page}}, {"hits": {"hits": [{"_source": final_story}]}}]
    with patch("routers.novel_studio.get_es", return_value=es), patch("routers.novel_studio.ensure_novel_stories_index", new=AsyncMock()):
        result = await list_novel_stories()
    assert len(result["stories"]) == 101
    assert result["stories"][-1] == final_story
    assert es.search.call_args.kwargs["search_after"] == ["99"]


@pytest.mark.asyncio
async def test_delete_is_idempotent_in_dedicated_index():

    story_id = uuid4()
    es = AsyncMock()
    es.delete.side_effect = NotFoundError("missing", meta=None, body=None)
    with patch("routers.novel_studio.get_es", return_value=es):
        assert await delete_novel_story(story_id) == {"ok": True}
    es.delete.assert_awaited_once_with(index=NOVEL_STORIES_INDEX, id=str(story_id), refresh="wait_for")


@pytest.mark.asyncio
async def test_novel_index_schema_is_created_explicitly():

    es = AsyncMock()
    es.indices.exists.return_value = False
    await ensure_novel_stories_index(es)
    call = es.indices.create.call_args.kwargs
    assert call["index"] == NOVEL_STORIES_INDEX
    properties = call["mappings"]["properties"]
    assert properties["chapters"]["properties"]["text"]["type"] == "text"
    assert properties["updated_at"]["type"] == "date"
    es.indices.exists.return_value = True
    await ensure_novel_stories_index(es)
    assert es.indices.create.await_count == 1


@pytest.mark.asyncio
async def test_synthesis_receives_selected_candidates_and_requests_explicit_conflict_handling():
    request = NovelGenerationRequest(title="Library", bible="Established notes", previous="", manuscript="", instruction="Combine", target="bible", settings_stage="synthesis", selected_settings=[{"category": "createCharacters", "title": "Librarian", "content": "Seo cannot leave the library"}, {"category": "createWorld", "title": "World", "content": "The library is on the moon"}])
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value="Final settings")) as model:
        await generate_novel(request)
    assert "Seo cannot leave the library" in model.call_args.args[0]
    assert "The library is on the moon" in model.call_args.args[0]
    assert "Synthesize ONLY the selected candidates" in model.call_args.args[2]
    assert "explicitly flag" in model.call_args.args[2]


@pytest.mark.asyncio
async def test_synthesis_requires_a_selection_before_calling_model():
    request = NovelGenerationRequest(title="", bible="", previous="", manuscript="", instruction="Combine", target="bible", settings_stage="synthesis")
    with patch("routers.novel_studio.query_llm", new=AsyncMock()) as model:
        with pytest.raises(HTTPException):
            await generate_novel(request)
    model.assert_not_called()


def test_saved_candidate_selection_and_content_survive_story_validation():
    story = NovelStory(id=uuid4(), title="Library", bible="Final", chapters=[NovelChapter(id=uuid4(), title="One", text="Prose")], settingsCandidates=[{"id": uuid4(), "category": "createStyle", "title": "Quiet suspense", "content": "Third person, restrained", "selected": True}])
    restored = NovelStory.model_validate(story.model_dump(mode="json"))
    assert restored.settingsCandidates[0].selected is True
    assert restored.settingsCandidates[0].content == "Third person, restrained"
    assert restored.bible == "Final"


@pytest.mark.parametrize("category", ["createDirection", "createPremise", "createCharacters", "createWorld", "createPlot", "createStyle"])
def test_six_recommended_categories_support_saved_candidates_and_generation(category):
    request = NovelGenerationRequest(title="Library", bible="", previous="", manuscript="", instruction="Develop", target="bible", settings_stage=category, selected_settings=[{"category": "createDirection", "title": "Mystery", "content": "Adult readers, quiet suspense"}])
    assert request.settings_stage == category
    story = NovelStory(id=uuid4(), title="Library", bible="", chapters=[NovelChapter(id=uuid4(), title="One", text="")], settingsCandidates=[{"id": uuid4(), "category": category, "title": "Idea", "content": "Notes", "selected": True}])
    assert story.settingsCandidates[0].category == category
