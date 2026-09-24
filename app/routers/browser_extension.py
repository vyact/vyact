"""Local API used by the Vyact Chrome extension browser executor."""
import json
import time

from fastapi import APIRouter, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from services.extension_browser import extension_browser
from services.extension_tools import extension_tool_catalog
from services.extension_settings import request_model_settings, request_tool_settings, settings_events


router = APIRouter(prefix="/browser-extension", tags=["browser-extension"])


class BrowserResult(BaseModel):
    ok: bool
    result: object | None = None
    error: str | None = None


@router.websocket("/ws")
async def browser_websocket(websocket: WebSocket):
    if websocket.client and websocket.client.host not in {"127.0.0.1", "::1"}:
        await websocket.close(code=1008)
        return
    origin = websocket.headers.get("origin", "")
    if origin and not origin.startswith("chrome-extension://"):
        await websocket.close(code=1008)
        return
    await websocket.accept()
    extension_browser.attach(websocket)
    previous_tools = None
    try:
        while True:
            message = await websocket.receive_json()
            extension_browser.last_seen = time.monotonic()
            if message.get("type") == "result":
                extension_browser.complete(str(message.get("id") or ""), {
                    "ok": message.get("ok") is True,
                    "result": message.get("result"),
                    "error": message.get("error"),
                })
            elif message.get("type") == "ping":
                await websocket.send_json({"type": "pong"})
            if message.get("type") in {"hello", "ping"}:
                try:
                    tools = await extension_tool_catalog()
                    if tools != previous_tools:
                        await websocket.send_json({"type": "tools_changed", "servers": tools})
                        previous_tools = tools
                except Exception:
                    pass  # A failed snapshot must not erase extension preferences.
    except WebSocketDisconnect:
        pass
    finally:
        extension_browser.detach(websocket)


def _require_local(request: Request) -> None:
    if request.client and request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(status_code=403, detail="Local extension access only")
    origin = request.headers.get("origin", "")
    if origin and not origin.startswith("chrome-extension://"):
        raise HTTPException(status_code=403, detail="Chrome extension origin required")


def _require_token(authorization: str) -> None:
    if authorization != f"Bearer {extension_browser.token}":
        raise HTTPException(status_code=403, detail="Invalid extension session")


@router.post("/connect")
async def connect(request: Request):
    _require_local(request)
    return {"token": extension_browser.register()}


@router.get("/commands")
async def commands(request: Request, timeout: float = 20, authorization: str = Header(default="")):
    _require_local(request)
    _require_token(authorization)
    return {"command": await extension_browser.next_command(timeout)}


@router.post("/commands/{command_id}/result")
async def command_result(command_id: str, payload: BrowserResult, request: Request, authorization: str = Header(default="")):
    _require_local(request)
    _require_token(authorization)
    return {"accepted": extension_browser.complete(command_id, payload.model_dump())}


@router.get("/tools")
async def get_extension_tools(request: Request):
    _require_local(request)
    return {"servers": await extension_tool_catalog()}


@router.get("/settings-events")
async def desktop_settings_events(request: Request):
    if request.client and request.client.host not in {"127.0.0.1", "::1"}:
        raise HTTPException(status_code=403, detail="Local desktop access only")

    async def stream():
        async for event in settings_events():
            yield f"data: {json.dumps(event)}\n\n" if event else ": heartbeat\n\n"

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@router.post("/tools/{server_id}/settings")
async def open_tool_settings(server_id: str, request: Request):
    _require_local(request)
    server = next((item for item in await extension_tool_catalog()
                   if item["id"] == server_id and item["type"] == "web_search"), None)
    if server is None:
        raise HTTPException(status_code=404, detail="Tool not found")
    if not request_tool_settings(server_id):
        raise HTTPException(status_code=503, detail="Desktop UI is not connected")
    return {"ok": True}


@router.post("/model-settings")
async def open_model_settings(request: Request):
    _require_local(request)
    if not request_model_settings():
        raise HTTPException(status_code=503, detail="Desktop UI is not connected")
    return {"ok": True}
