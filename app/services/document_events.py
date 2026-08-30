"""In-process change events for the saved-document snapshot."""
import asyncio
from collections.abc import AsyncIterator


DOCUMENT_EVENT_QUEUE_SIZE = 1

_document_change_subscribers: set[asyncio.Queue[None]] = set()


def publish_document_change() -> None:
    """Notify connected clients that saved-document data changed."""
    for subscriber in tuple(_document_change_subscribers):
        if subscriber.full():
            continue
        subscriber.put_nowait(None)


async def subscribe_document_events(
    heartbeat_seconds: float,
) -> AsyncIterator[bool]:
    """Yield document changes and periodic heartbeat markers."""
    subscriber: asyncio.Queue[None] = asyncio.Queue(
        maxsize=DOCUMENT_EVENT_QUEUE_SIZE,
    )
    _document_change_subscribers.add(subscriber)
    try:
        while True:
            try:
                await asyncio.wait_for(
                    subscriber.get(),
                    timeout=heartbeat_seconds,
                )
                yield True
            except TimeoutError:
                yield False
    finally:
        _document_change_subscribers.discard(subscriber)
