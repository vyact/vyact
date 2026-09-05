from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.microsoft_workspace import backup, auth
from routers.backup import _preserve_workspace_on_restore, INTEGRATION_SETTINGS_INDEX


@pytest.mark.asyncio
async def test_backup_upload_uses_selected_account_and_chunk_ranges():
    content = b"backup-data"
    client = AsyncMock()
    client.put.return_value = httpx.Response(201, json={"id": "uploaded", "name": "backup.zip"})
    with patch.object(backup, "graph", AsyncMock(side_effect=[
        {"id": "folder", "folder": {}}, {"uploadUrl": "https://upload.example.test/session"}
    ])) as graph, patch.object(backup.httpx, "AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        result = await backup.upload_backup(content, "backup.zip", "selected-ms")
    assert result["file_id"] == "uploaded"
    assert all(call.kwargs["account_id"] == "selected-ms" for call in graph.call_args_list)
    assert client.put.call_args.kwargs["content"] == content
    assert client.put.call_args.kwargs["headers"]["Content-Range"] == "bytes 0-10/11"
    assert "Authorization" not in client.put.call_args.kwargs["headers"]


@pytest.mark.asyncio
@pytest.mark.parametrize("provider", ["google_workspace", "microsoft_workspace"])
async def test_restore_preserves_current_workspace_settings(provider):
    current = {"type": provider, "config": {"client_id": "current", "accounts": [{"id": "local"}]}}
    other = {"type": "custom", "config": {}}
    config = {"servers": [{"type": provider, "config": {"client_id": "backup"}}, other]}
    payload = {"indices": {INTEGRATION_SETTINGS_INDEX: {"docs": [{"_id": "mcp", "_source": {"value": config}}]}}}
    with patch("routers.backup.list_servers", AsyncMock(return_value=[current])):
        assert await _preserve_workspace_on_restore(payload, provider)
    assert config["servers"] == [other, current]


@pytest.mark.asyncio
async def test_restore_without_integration_settings_does_not_require_reconnection():
    with patch("routers.backup.list_servers", AsyncMock()) as servers:
        assert not await _preserve_workspace_on_restore({"indices": {}}, "microsoft_workspace")
    servers.assert_not_awaited()


@pytest.mark.asyncio
async def test_microsoft_restore_revokes_only_microsoft_tokens_and_pending_login():
    es = AsyncMock()
    with patch.object(auth, "get_es", return_value=es), patch.object(auth, "_pending", {"state": {"account_id": "one"}}), patch.object(auth, "_generations", {}), patch.object(auth, "_locks", {}):
        await auth.revoke_all_tokens()
        assert auth._pending == {}
        assert auth._generations["one"] == 1
    assert es.delete_by_query.call_args.kwargs["query"] == {"prefix": {"key": "microsoft_token_"}}
    es.close.assert_awaited_once()
