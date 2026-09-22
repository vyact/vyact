import json
from pathlib import Path
from unittest.mock import AsyncMock

import pytest

from services import mcp_config
from services.workspace_prompts import WORKSPACE_RULES, get_workspace_prompt


@pytest.mark.parametrize('language', list(WORKSPACE_RULES))
@pytest.mark.parametrize('provider', ['google_workspace', 'microsoft_workspace'])
def test_frontend_reset_matches_backend_default(language, provider):
    root = Path(__file__).resolve().parents[2]
    translations = json.loads((root / 'frontend/src/i18n/locales' / language / 'settings.json').read_text())
    actual = translations['microsoft']['defaultPrompt'] if provider == 'microsoft_workspace' else translations['mcpDefaultPrompts'][provider]
    assert actual == get_workspace_prompt(provider, language)


@pytest.mark.asyncio
@pytest.mark.parametrize('provider', ['google_workspace', 'microsoft_workspace'])
async def test_empty_prompt_uses_localized_default_and_custom_prompt_is_preserved(monkeypatch, provider):
    server = {'id': 'test', 'type': provider, 'enabled': True, 'prompt': ''}
    monkeypatch.setattr(mcp_config, 'list_servers', AsyncMock(return_value=[server]))
    monkeypatch.setattr(mcp_config, 'get_tool_language', AsyncMock(return_value='ko-KR'))
    assert await mcp_config.get_active_mcp_prompt() == get_workspace_prompt(provider, 'ko')
    server['prompt'] = 'My custom instructions'
    assert await mcp_config.get_active_mcp_prompt() == 'My custom instructions'
    assert await mcp_config.get_active_mcp_prompt(set()) == ''


def test_catalog_defaults_and_unknown_language():
    for provider in ['google_workspace', 'microsoft_workspace']:
        assert mcp_config.MCP_CATALOG[provider]['default_prompt'] == get_workspace_prompt(provider, 'en')
        assert get_workspace_prompt(provider, 'unknown') == get_workspace_prompt(provider, 'en')
