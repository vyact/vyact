from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import httpx
import pytest

from services import product_release_polling


def test_poll_is_due_only_after_twenty_four_hours():
    now = datetime(2026, 8, 22, tzinfo=timezone.utc)

    assert product_release_polling._is_poll_due(None, now)
    assert not product_release_polling._is_poll_due(now - timedelta(hours=23), now)
    assert product_release_polling._is_poll_due(now - timedelta(hours=24), now)


@pytest.mark.asyncio
async def test_failed_request_still_records_attempt(monkeypatch):
    attempted_at = AsyncMock()
    monkeypatch.setattr(product_release_polling, "_load_last_attempted_at", AsyncMock(return_value=None))
    monkeypatch.setattr(product_release_polling, "_record_attempted_at", attempted_at)

    class FailingClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            raise httpx.ConnectError("deployment in progress")

    monkeypatch.setattr(product_release_polling.httpx, "AsyncClient", lambda **_kwargs: FailingClient())

    await product_release_polling.poll_product_releases()

    attempted_at.assert_awaited_once()


@pytest.mark.asyncio
async def test_successful_request_preserves_all_translations(monkeypatch):
    translations = {
        "ko": {"title": "새 기능", "message": "설명"},
        "en": {"title": "New feature", "message": "Description"},
    }
    create_notification = AsyncMock()
    monkeypatch.setattr(product_release_polling, "_load_last_attempted_at", AsyncMock(return_value=None))
    monkeypatch.setattr(product_release_polling, "_record_attempted_at", AsyncMock())
    monkeypatch.setattr(product_release_polling, "create_notification", create_notification)

    response = httpx.Response(
        200,
        request=httpx.Request("GET", product_release_polling.PRODUCT_RELEASE_API_URL),
        json={"result": {"releases": [{
            "id": "release-1",
            "translations": translations,
            "platforms": ["desktop"],
            "publishedAt": "2026-08-22T00:00:00Z",
        }]}},
    )

    class SuccessfulClient:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *_args):
            return None

        async def get(self, _url):
            return response

    monkeypatch.setattr(product_release_polling.httpx, "AsyncClient", lambda **_kwargs: SuccessfulClient())

    await product_release_polling.poll_product_releases()

    assert create_notification.await_args.kwargs["translations"] == translations
    assert "occurred_at" not in create_notification.await_args.kwargs
