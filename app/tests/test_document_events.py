import asyncio

import pytest

from services.document_events import (
    publish_document_change,
    subscribe_document_events,
)


@pytest.mark.asyncio
async def test_document_change_reaches_active_subscriber():
    events = subscribe_document_events(heartbeat_seconds=1)
    next_event = asyncio.create_task(anext(events))
    await asyncio.sleep(0)

    publish_document_change()

    assert await next_event is True
    await events.aclose()


@pytest.mark.asyncio
async def test_document_event_subscription_emits_heartbeat():
    events = subscribe_document_events(heartbeat_seconds=0.001)

    assert await anext(events) is False
    await events.aclose()
