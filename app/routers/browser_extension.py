"""Local API used by the Vyact Chrome extension browser executor."""
from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import BaseModel

from services.extension_browser import extension_browser


router = APIRouter(prefix="/browser-extension", tags=["browser-extension"])


class BrowserResult(BaseModel):
    ok: bool
    result: object | None = None
    error: str | None = None


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
