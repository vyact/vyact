"""Upload a generated backup to the explicitly selected OneDrive account."""
from urllib.parse import quote

import httpx
from fastapi import HTTPException

from services.microsoft_workspace.auth import graph

UPLOAD_CHUNK_BYTES = 10 * 320 * 1024


async def upload_backup(content: bytes, filename: str, account_id: str) -> dict:
    try:
        folder = await graph("/me/drive/root:/vyact", account_id=account_id)
        if "folder" not in folder:
            raise HTTPException(409, "microsoft.invalidRequest")
    except HTTPException as error:
        if error.status_code != 404:
            raise
        folder = await graph("/me/drive/root/children", "POST",
                             json={"name": "vyact", "folder": {}, "@microsoft.graph.conflictBehavior": "fail"},
                             account_id=account_id)
    path = f"/me/drive/items/{quote(folder['id'], safe='')}:/{quote(filename, safe='')}:"
    session = await graph(path + "/createUploadSession", "POST",
                          json={"item": {"@microsoft.graph.conflictBehavior": "fail"}}, account_id=account_id)
    url = session.get("uploadUrl", "")
    if not url.startswith("https://"):
        raise HTTPException(502, "microsoft.requestFailed")
    uploaded = None
    async with httpx.AsyncClient(timeout=120) as client:
        for offset in range(0, len(content), UPLOAD_CHUNK_BYTES):
            chunk = content[offset:offset + UPLOAD_CHUNK_BYTES]
            response = await client.put(url, content=chunk, headers={
                "Content-Length": str(len(chunk)),
                "Content-Range": f"bytes {offset}-{offset + len(chunk) - 1}/{len(content)}",
            })
            if response.status_code in (200, 201):
                uploaded = response.json()
            elif response.status_code != 202:
                raise HTTPException(502, "microsoft.requestFailed")
    if not uploaded or "id" not in uploaded:
        raise HTTPException(502, "microsoft.requestFailed")
    return {"ok": True, "file_id": uploaded["id"], "file_name": uploaded["name"],
            "web_link": uploaded.get("webUrl", ""), "folder_id": folder["id"]}
