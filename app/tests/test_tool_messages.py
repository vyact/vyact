import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from services.mcp_client import MCPManager
from services.tool_messages import MESSAGES, tool_message
from services.llm.tools import tool_result_failed


@pytest.mark.asyncio
@pytest.mark.parametrize("language", list(MESSAGES))
async def test_internal_failure_is_localized_and_machine_readable(language):
    manager = MCPManager()
    manager.register_internal_tool("test", "test", {}, AsyncMock(side_effect=ValueError("detail")))
    with patch("services.mcp_client.get_tool_language", AsyncMock(return_value=language)):
        result = await manager.call_tool("test", {})
    assert tool_result_failed(result)
    assert json.loads(result)["error"] == tool_message("execution_failed", language, tool="test", detail="detail")


def test_external_error_and_empty_results():
    result = MCPManager._result_to_text(SimpleNamespace(content=[], isError=True), "en")
    assert tool_result_failed(result)
    assert json.loads(result)["error"] == "Unknown error"
    assert MCPManager._result_to_text(SimpleNamespace(content=[]), "en") == "(No result)"
    assert tool_message("no_result", "fr-FR") == "(Aucun résultat)"
    assert tool_message("no_result", "unsupported") == "(No result)"
