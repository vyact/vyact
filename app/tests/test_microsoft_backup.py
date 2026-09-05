from unittest.mock import AsyncMock, patch

import httpx
import pytest

from services.microsoft_workspace import backup


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
