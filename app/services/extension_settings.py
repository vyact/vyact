"""Transient extension requests delivered to the running desktop UI."""
import asyncio
from collections.abc import AsyncIterator

_subscribers: set[asyncio.Queue] = set()


def _publish_settings_event(event: dict) -> bool:
    if not _subscribers:
        return False
    for queue in tuple(_subscribers):
        if queue.full():
            queue.get_nowait()
        queue.put_nowait(event)
    return True


def request_tool_settings(server_id: str) -> bool:
    return _publish_settings_event({"tab": "api", "mcpServerId": server_id})


def request_model_settings() -> bool:
    return _publish_settings_event({"target": "model_settings"})


async def settings_events() -> AsyncIterator[dict | None]:
    queue: asyncio.Queue = asyncio.Queue(maxsize=1)
    _subscribers.add(queue)
    try:
        yield None
        while True:
            try:
                yield await asyncio.wait_for(queue.get(), timeout=15)
            except asyncio.TimeoutError:
                yield None
    finally:
        _subscribers.discard(queue)
