from unittest.mock import AsyncMock

import pytest

from routers import chat
from services import user_profile


@pytest.mark.asyncio
@pytest.mark.parametrize('profile', [None, {}, {'response_style': 'default'}, {'response_style': 'unknown'}])
async def test_default_or_unknown_style_preserves_system_prompt(monkeypatch, profile):
    monkeypatch.setattr(user_profile, 'get_user_profile', AsyncMock(return_value=profile))
    assert await user_profile.get_response_style_instruction() == ''
    assert await chat._with_response_style('Original instructions') == 'Original instructions'


@pytest.mark.asyncio
@pytest.mark.parametrize('style', list(user_profile.RESPONSE_STYLE_INSTRUCTIONS))
async def test_saved_style_applies_without_profile_text(monkeypatch, style):
    monkeypatch.setattr(user_profile, 'get_user_profile', AsyncMock(return_value={'response_style': style, 'profile': None}))
    prompt = await chat._with_response_style('Answer in Japanese using the requested format.')
    assert prompt.startswith('Answer in Japanese using the requested format.\n\n[Response style and tone]\n')
    assert user_profile.RESPONSE_STYLE_GUIDANCE in prompt
    assert user_profile.RESPONSE_STYLE_INSTRUCTIONS[style] in prompt


@pytest.mark.asyncio
async def test_profile_read_failure_does_not_break_chat(monkeypatch):
    monkeypatch.setattr(user_profile, 'get_user_profile', AsyncMock(side_effect=RuntimeError('unavailable')))
    assert await chat._with_response_style('Original instructions') == 'Original instructions'
