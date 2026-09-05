"""Network-facing OpenAI-compatible gateway for the loopback-only model runtime."""
import hmac
import json
from collections.abc import AsyncIterator

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, StreamingResponse

from services.model_benchmark import BenchmarkGuard
from services.vyact_runtime import VYACT_RUNTIME_URL

EXTERNAL_API_PORT = 11436
EXTERNAL_API_BASE_PATH = "/v1"
HOP_BY_HOP_HEADERS = {
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailers", "transfer-encoding", "upgrade", "content-length",
}


async def _load_external_api_context() -> tuple[dict, dict]:
    from routers.deps import load_config_async
    config = await load_config_async()
    return config, config.get("external_api", {})


def public_model_id(config: dict) -> str:
    vyact_config = config.get("vyact_config", {})
    model_path = str(vyact_config.get("model_path") or "")
    return model_path.removeprefix("mlx/") or str(vyact_config.get("model") or config.get("model") or "")


def _authorized(request: Request, settings: dict) -> bool:
    if not settings.get("auth_enabled"):
        return True
    token = str(settings.get("api_token") or "")
    supplied = request.headers.get("Authorization", "")
    expected = f"Bearer {token}"
    return bool(token) and hmac.compare_digest(supplied, expected)


def rewrite_request_model(body: bytes, content_type: str, config: dict) -> bytes:
    if not body or not content_type.startswith("application/json"):
        return body
    try:
        payload = json.loads(body)
    except (TypeError, ValueError):
        return body
    if not isinstance(payload, dict) or "model" not in payload:
        return body
    internal_model_id = str(config.get("vyact_config", {}).get("model") or config.get("model") or "")
    if not internal_model_id:
        return body
    payload["model"] = internal_model_id
    return json.dumps(payload, ensure_ascii=False).encode()


external_api_app = FastAPI(title="Vyact Local Model API", docs_url=None, redoc_url=None, openapi_url=None)

external_api_app.add_middleware(BenchmarkGuard)

@external_api_app.api_route("/v1/models", methods=["GET"])
async def list_models(request: Request):
    config, settings = await _load_external_api_context()
    if not _authorized(request, settings):
        return JSONResponse({"error": {"message": "Invalid API token", "type": "authentication_error"}}, status_code=401, headers={"WWW-Authenticate": "Bearer"})
    model_id = public_model_id(config)
    data = [{"id": model_id, "object": "model", "owned_by": "vyact"}] if model_id else []
    return {"object": "list", "data": data}


@external_api_app.api_route("/v1/{path:path}", methods=["POST", "GET", "OPTIONS"])
async def proxy_model_api(path: str, request: Request):
    config, settings = await _load_external_api_context()
    if not _authorized(request, settings):
        return JSONResponse({"error": {"message": "Invalid API token", "type": "authentication_error"}}, status_code=401, headers={"WWW-Authenticate": "Bearer"})

    body = await request.body()
    body = rewrite_request_model(body, request.headers.get("content-type", ""), config)

    headers = {
        name: value for name, value in request.headers.items()
        if name.lower() not in HOP_BY_HOP_HEADERS and name.lower() not in {"host", "authorization"}
    }
    client = httpx.AsyncClient(timeout=None)
    upstream_url = f"{VYACT_RUNTIME_URL}/{path}"
    if request.url.query:
        upstream_url = f"{upstream_url}?{request.url.query}"
    upstream_request = client.build_request(request.method, upstream_url, headers=headers, content=body)
    try:
        upstream = await client.send(upstream_request, stream=True)
    except httpx.HTTPError as error:
        await client.aclose()
        return JSONResponse({"error": {"message": str(error), "type": "upstream_error"}}, status_code=502)

    response_headers = {
        name: value for name, value in upstream.headers.items()
        if name.lower() not in HOP_BY_HOP_HEADERS
    }

    async def stream_body() -> AsyncIterator[bytes]:
        try:
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(stream_body(), status_code=upstream.status_code, headers=response_headers, media_type=upstream.headers.get("content-type"))
