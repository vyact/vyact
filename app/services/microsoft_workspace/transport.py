"""Every Microsoft HTTP request shares persistent budgets, including signed upload URLs."""
import json

import httpx
from fastapi import HTTPException

from logger import get_logger
from services.microsoft_workspace import request_limits as limits

logger = get_logger(__name__)


def json_upload_bytes(value) -> int:
    return len(json.dumps(value, ensure_ascii=False).encode())


async def managed_request(client: httpx.AsyncClient, scope: str, method: str, url: str,
                          *, units: int = 1, batch: bool = False, **kwargs) -> httpx.Response:
    content = kwargs.get('content')
    upload_bytes = len(content.encode() if isinstance(content, str) else content) if isinstance(content, (bytes, str)) else 0
    if kwargs.get('json') is not None:
        upload_bytes = json_upload_bytes(kwargs['json'])
    if method.upper() not in ('POST', 'PUT', 'PATCH') or batch:
        upload_bytes = 0
    async with limits.request_limiter.request(scope, units, upload_bytes):
        try:
            response = await client.request(method, url, **kwargs)
        except httpx.RequestError as error:
            logger.warning('Microsoft transport failure scope=%s method=%s error=%s', scope, method, type(error).__name__)
            raise HTTPException(503, 'microsoft_connection_failed') from error
        if response.status_code == 429:
            logger.warning('Microsoft request throttled scope=%s method=%s retry_after=%s', scope, method, response.headers.get('Retry-After', ''))
            raise limits.request_limiter.block(scope, response.headers.get('Retry-After'))
        if batch and response.is_success:
            throttled = [entry for entry in response.json().get('responses', []) if entry.get('status') == 429]
            if throttled:
                delays = []
                for entry in throttled:
                    headers = {key.lower(): value for key, value in entry.get('headers', {}).items()}
                    delay = limits.request_limiter.retry_delay(headers.get('retry-after'), limits.request_limiter.clock())
                    if delay is not None:
                        delays.append(delay)
                logger.warning('Microsoft batch throttled scope=%s count=%s', scope, len(throttled))
                raise limits.request_limiter.block(scope, str(max(delays)) if delays else None)
        return response
