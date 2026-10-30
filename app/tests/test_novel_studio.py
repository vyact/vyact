from routers.novel_studio import TitleSuggestionRequest, suggest_novel_titles
from unittest.mock import AsyncMock, patch
from uuid import uuid4
from elasticsearch import NotFoundError
from services.db import NOVEL_STORIES_INDEX, ensure_novel_stories_index
from routers.novel_studio import NovelChapter, NovelStory, save_novel_story, list_novel_stories, delete_novel_story

import pytest
from fastapi import HTTPException
from pydantic import ValidationError
from routers.novel_studio import NovelGenerationRequest, generate_novel


def test_story_preserves_per_action_guidance_and_legacy_defaults():
    source = {'id': str(uuid4()), 'title': 'Story', 'chapters': [{'id': str(uuid4()), 'title': 'One', 'text': ''}]}
    legacy = NovelStory.model_validate(source)
    assert legacy.taskGuidance == {}
    assert legacy.includeTaskGuidance is True
    source.update(taskGuidance={'write': 'My writing instruction', 'createPlot': 'My plot instruction'}, includeTaskGuidance=False)
    restored = NovelStory.model_validate(NovelStory.model_validate(source).model_dump(mode='json'))
    assert restored.taskGuidance == source['taskGuidance']
    assert restored.includeTaskGuidance is False
    source['taskGuidance'] = {'write': 'x' * 2501}
    with pytest.raises(ValidationError):
        NovelStory.model_validate(source)


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
    assert properties["taskGuidance"] == {"type": "object", "enabled": False}
    assert properties["includeTaskGuidance"] == {"type": "boolean"}
    es.indices.exists.return_value = True
    await ensure_novel_stories_index(es)
    assert es.indices.create.await_count == 1
    migrated = es.indices.put_mapping.call_args.kwargs
    assert migrated['index'] == NOVEL_STORIES_INDEX
    assert migrated['properties']['taskGuidance'] == properties['taskGuidance']
    assert migrated['properties']['includeTaskGuidance'] == properties['includeTaskGuidance']
    es.indices.delete.assert_not_awaited()


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
    story = NovelStory(id=uuid4(), title="Library", bible="Final", chapters=[NovelChapter(id=uuid4(), title="One", text="Prose")], settingsCandidates=[{"id": uuid4(), "category": "createStyle", "title": "Quiet suspense", "content": "Third person, restrained", "selected": True, "generationInstruction": "Choose a restrained voice.\n\nUse third person.", "authorDirection": "Use third person."}])
    restored = NovelStory.model_validate(story.model_dump(mode="json"))
    assert restored.settingsCandidates[0].selected is True
    assert restored.settingsCandidates[0].content == "Third person, restrained"
    assert restored.finalSettings == []
    assert restored.settingsCandidates[0].generationInstruction == "Choose a restrained voice.\n\nUse third person."
    assert restored.settingsCandidates[0].authorDirection == "Use third person."


@pytest.mark.parametrize("category", ["createDirection", "createPremise", "createCharacters", "createWorld", "createPlot", "createStyle"])
def test_six_recommended_categories_support_saved_candidates_and_generation(category):
    request = NovelGenerationRequest(title="Library", bible="", previous="", manuscript="", instruction="Develop", target="bible", settings_stage=category, selected_settings=[{"category": "createDirection", "title": "Mystery", "content": "Adult readers, quiet suspense"}])
    assert request.settings_stage == category
    story = NovelStory(id=uuid4(), title="Library", bible="", chapters=[NovelChapter(id=uuid4(), title="One", text="")], settingsCandidates=[{"id": uuid4(), "category": category, "title": "Idea", "content": "Notes", "selected": True}])
    assert story.settingsCandidates[0].category == category


@pytest.mark.asyncio
async def test_candidate_generation_returns_a_suggested_title_and_full_content():
    request = NovelGenerationRequest(title="Library", bible="", previous="", manuscript="", instruction="Develop direction", target="bible", settings_stage="createDirection")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"title":" 기억을 빌리는 미스터리 ","text":"# 작품 방향\\n\\n전체 제안 내용"}')) as model:
        response = await generate_novel(request)
    assert response == {"title": "기억을 빌리는 미스터리", "text": "# 작품 방향\n\n전체 제안 내용"}
    assert 'keys "title" and "text"' in model.call_args.args[2]
    model.assert_awaited_once()


@pytest.mark.asyncio
async def test_manuscript_generation_returns_chapter_title_with_prose():
    request = NovelGenerationRequest(title="The library", chapter_title="Chapter 2", bible="", previous="", manuscript="", instruction="Write the opening", target="text")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"title":"The door at midnight","text":"The last light went out."}')) as model:
        response = await generate_novel(request)
    assert response == {"title": "The door at midnight", "text": "The last light went out."}
    assert "Current chapter title: Chapter 2" in model.call_args.args[0]
    assert "CURRENT CHAPTER" in model.call_args.args[2]
    model.assert_awaited_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("stage,expected", [("createDirection", []), ("createPremise", ["direction-note"]), ("createCharacters", ["direction-note", "premise-note"]), ("synthesis", ["direction-note", "premise-note", "character-note"])])
async def test_candidate_context_only_includes_earlier_categories(stage, expected):
    notes = [{"category": category, "title": title, "content": title} for category, title in [("createDirection", "direction-note"), ("createPremise", "premise-note"), ("createCharacters", "character-note")]]
    body = NovelGenerationRequest(title="Story", bible="", previous="", manuscript="", instruction="Propose", target="bible", settings_stage=stage, selected_settings=notes)
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value="Proposal")) as model:
        await generate_novel(body)
    prompt = model.call_args.args[0]
    for note in notes:
        assert (note["title"] in prompt) == (note["title"] in expected)


@pytest.mark.asyncio
async def test_revision_includes_current_proposal_and_latest_instruction():
    body = NovelGenerationRequest(title="Story", bible="", previous="", manuscript="", instruction="Change motivation", target="bible", settings_stage="createCharacters", proposal="Current character draft", original_instruction="Create a detective")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"title":"Revised detective","text":"Updated character"}')) as model:
        assert await generate_novel(body) == {"title": "Revised detective", "text": "Updated character"}
    assert "Current character draft" in model.call_args.args[0]
    assert "Change motivation" in model.call_args.args[0]
    assert "Create a detective" in model.call_args.args[0]
    assert "complete revised proposal" in model.call_args.args[2]


@pytest.mark.asyncio
async def test_synthesis_revision_can_turn_off_all_additional_candidates():
    body = NovelGenerationRequest(title="Story", bible="", previous="", manuscript="", instruction="Refine the tone", target="bible", settings_stage="synthesis", proposal="Existing synthesis", selected_settings=[])
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value="Revised synthesis")) as model:
        assert await generate_novel(body) == {"text": "Revised synthesis"}
    assert "Existing synthesis" in model.call_args.args[0]


def test_multiple_final_settings_and_active_selection_survive_round_trip():
    first, second = uuid4(), uuid4()
    story = NovelStory(id=uuid4(), title="Story", chapters=[NovelChapter(id=uuid4(), title="One", text="")], finalSettings=[{"id": first, "title": "Version A", "content": "Quiet mystery"}, {"id": second, "title": "Version B", "content": "Fast thriller"}], activeFinalSettingId=second)
    restored = NovelStory.model_validate(story.model_dump(mode="json"))
    assert [item.content for item in restored.finalSettings] == ["Quiet mystery", "Fast thriller"]
    assert restored.activeFinalSettingId == second


def test_invalid_final_setting_selection_and_duplicate_versions_are_rejected():
    identifier = uuid4()
    base = {"id": uuid4(), "title": "Story", "chapters": [{"id": uuid4(), "title": "One", "text": ""}]}
    with pytest.raises(ValidationError):
        NovelStory(**base, activeFinalSettingId=identifier)
    version = {"id": identifier, "title": "Version", "content": "Settings"}
    with pytest.raises(ValidationError):
        NovelStory(**base, finalSettings=[version, version])


@pytest.mark.asyncio
@pytest.mark.parametrize("revision", [False, True])
async def test_final_synthesis_returns_generated_name_and_markdown(revision):
    body = NovelGenerationRequest(title="Story", bible="", previous="", manuscript="", instruction="Refine" if revision else "Combine", target="bible", settings_stage="synthesis", proposal="Previous version" if revision else "", selected_settings=[{"category": "createDirection", "title": "Mystery", "content": "Financial investigation"}])
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"title":"Market mystery — restrained suspense","text":"# Final settings\\nComplete content"}')) as model:
        result = await generate_novel(body)
    assert result["title"] == "Market mystery — restrained suspense"
    assert result["text"] == "# Final settings\nComplete content"
    assert 'keys "title" and "text"' in model.call_args.args[2]


@pytest.mark.asyncio
async def test_title_suggestions_use_explicit_sources_and_configured_model():
    body = TitleSuggestionRequest(current_title="Work", sources=[{"title": "Chapter 2", "content": "Selected full prose"}], instruction="Short titles", language="ko")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"suggestions":[{"title":"  Market clues  ","reason":"Fits the mystery"}]}')) as model:
        assert await suggest_novel_titles(body) == {"suggestions": [{"title": "Market clues", "reason": "Fits the mystery"}]}
    assert "Selected full prose" in model.call_args.args[0]
    assert "Short titles" in model.call_args.args[0]
    assert model.call_args.kwargs["use_tools"] is False
    assert model.call_args.kwargs["inject_user_profile"] is False


def test_title_suggestion_context_requires_sources_and_preserves_long_content():
    with pytest.raises(ValidationError):
        TitleSuggestionRequest(current_title="Work", sources=[])
    text = "x" * 150000
    request = TitleSuggestionRequest(current_title="Work", sources=[{"title": "One", "content": text}])
    assert request.sources[0].content == text


@pytest.mark.asyncio
async def test_invalid_title_response_returns_error_instead_of_applying_text():
    body = TitleSuggestionRequest(current_title="Work", sources=[{"title": "One", "content": "Prose"}])
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"suggestions":[{"title":"","reason":"Bad"}]}')):
        with pytest.raises(HTTPException) as failure:
            await suggest_novel_titles(body)
    assert failure.value.status_code == 502


@pytest.mark.asyncio
async def test_manuscript_revision_sends_full_original_and_requests_full_replacement():
    manuscript = "Opening passage\n" + "x" * 31000 + "\nClosing passage"
    body = NovelGenerationRequest(title="Story", bible="", previous="", manuscript=manuscript, instruction="Change the closing scene", target="text")
    with patch("routers.novel_studio.query_llm", new=AsyncMock(return_value='{"title":"Revised chapter","text":"Complete revised chapter"}')) as model:
        assert await generate_novel(body) == {"title": "Revised chapter", "text": "Complete revised chapter"}
    assert manuscript in model.call_args.args[0]
    assert "COMPLETE updated manuscript" in model.call_args.args[2]
    assert "only new prose" not in model.call_args.args[2]
