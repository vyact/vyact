from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.microsoft_workspace import backup, auth, request_limits as limits
from routers.backup import _preserve_workspace_on_restore, INTEGRATION_SETTINGS_INDEX


@pytest.mark.asyncio
async def test_backup_upload_uses_selected_account_and_chunk_ranges(tmp_path, monkeypatch):
    monkeypatch.setattr(limits, "request_limiter", limits.MicrosoftRequestLimiter(tmp_path / "limits.db"))
    monkeypatch.setattr(auth, "scope_for_account", AsyncMock(return_value=limits.request_scope("client", "selected-ms", "drive")))
    content = b"backup-data"
    client = AsyncMock()
    client.request.return_value = httpx.Response(201, json={"id": "uploaded", "name": "backup.zip"})
    with patch.object(backup, "graph", AsyncMock(side_effect=[
        {"id": "folder", "folder": {}}, {"uploadUrl": "https://upload.example.test/session"}
    ])) as graph, patch.object(backup.httpx, "AsyncClient") as factory:
        factory.return_value.__aenter__.return_value = client
        result = await backup.upload_backup(content, "backup.zip", "selected-ms")
    assert result["file_id"] == "uploaded"
    assert all(call.kwargs["account_id"] == "selected-ms" for call in graph.call_args_list)
    assert client.request.call_args.kwargs["content"] == content
    assert client.request.call_args.kwargs["headers"]["Content-Range"] == "bytes 0-10/11"
    assert "Authorization" not in client.request.call_args.kwargs["headers"]


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


@pytest.mark.asyncio
async def test_backup_upload_accepts_250_mb_without_general_file_limit(monkeypatch):
    content = bytes(250_000_000)
    transferred = 0
    requests = 0

    async def receive_chunk(client, method, url, *, account_id, content, headers):
        nonlocal transferred, requests
        assert method == "PUT"
        assert account_id == "selected-ms"
        assert len(content) <= backup.UPLOAD_CHUNK_BYTES
        assert headers["Content-Range"] == f"bytes {transferred}-{transferred + len(content) - 1}/250000000"
        assert headers["Content-Length"] == str(len(content))
        transferred += len(content)
        requests += 1
        if transferred == 250_000_000:
            return httpx.Response(201, json={"id": "uploaded", "name": "backup.zip"})
        return httpx.Response(202, json={"nextExpectedRanges": [f"{transferred}-"]})

    monkeypatch.setattr(backup, "external_request", receive_chunk)
    monkeypatch.setattr(backup, "graph", AsyncMock(side_effect=[
        {"id": "folder", "folder": {}}, {"uploadUrl": "https://upload.example.test/session"},
    ]))
    result = await backup.upload_backup(content, "backup.zip", "selected-ms")
    assert result["file_id"] == "uploaded"
    assert transferred == len(content)
    assert requests == (len(content) + backup.UPLOAD_CHUNK_BYTES - 1) // backup.UPLOAD_CHUNK_BYTES
