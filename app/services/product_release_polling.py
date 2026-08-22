"""Periodically import Vyact product releases from the Vyvow API."""
import asyncio
from datetime import datetime, timedelta, timezone
import os

import httpx

from logger import get_logger
from services.db import SETTINGS_INDEX, get_es
from services.notifications import create_notification

logger = get_logger(__name__)

PRODUCT_RELEASE_POLL_STATE_ID = "product_release_poll_state"
PRODUCT_RELEASE_POLL_INTERVAL = timedelta(hours=24)
PRODUCT_RELEASE_SCHEDULER_INTERVAL_SECONDS = 60 * 60
PRODUCT_RELEASE_REQUEST_TIMEOUT_SECONDS = 10
PRODUCT_RELEASE_API_URL = (
    f"{os.getenv('VYVOW_API_BASE_URL', 'https://api.vyvow.com').rstrip('/')}"
    "/api/vyact/releases"
)
PRODUCT_RELEASE_NOTIFICATION_TYPE = "product_release"
PRODUCT_RELEASE_PLATFORM = "desktop"
PRODUCT_RELEASE_FALLBACK_LANGUAGES = ("en", "ko")

_polling_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None


def _utc_now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_datetime(value: object) -> datetime | None:
    if not isinstance(value, str) or not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


async def _load_last_attempted_at() -> datetime | None:
    es = get_es()
    try:
        result = await es.get(
            index=SETTINGS_INDEX,
            id=PRODUCT_RELEASE_POLL_STATE_ID,
            ignore=[404],
        )
        if not result.get("found"):
            return None
        value = result.get("_source", {}).get("value", {})
        return _parse_datetime(value.get("last_attempted_at") if isinstance(value, dict) else None)
    finally:
        await es.close()


async def _record_attempted_at(attempted_at: datetime) -> None:
    es = get_es()
    try:
        attempted_at_text = attempted_at.isoformat().replace("+00:00", "Z")
        await es.index(
            index=SETTINGS_INDEX,
            id=PRODUCT_RELEASE_POLL_STATE_ID,
            document={
                "key": PRODUCT_RELEASE_POLL_STATE_ID,
                "value": {"last_attempted_at": attempted_at_text},
            },
            refresh=True,
        )
    finally:
        await es.close()


def _is_poll_due(last_attempted_at: datetime | None, now: datetime) -> bool:
    return last_attempted_at is None or now - last_attempted_at >= PRODUCT_RELEASE_POLL_INTERVAL


def _release_supports_desktop(release: dict) -> bool:
    platforms = release.get("platforms")
    return not isinstance(platforms, list) or not platforms or PRODUCT_RELEASE_PLATFORM in platforms


def _fallback_translation(translations: dict) -> dict:
    for language in PRODUCT_RELEASE_FALLBACK_LANGUAGES:
        translation = translations.get(language)
        if isinstance(translation, dict):
            return translation
    return next((value for value in translations.values() if isinstance(value, dict)), {})


async def _save_release_notifications(releases: list) -> None:
    for release in releases:
        if not isinstance(release, dict) or not _release_supports_desktop(release):
            continue
        release_id = release.get("id")
        translations = release.get("translations")
        if not isinstance(release_id, str) or not release_id or not isinstance(translations, dict):
            continue
        fallback = _fallback_translation(translations)
        await create_notification(
            notification_type=PRODUCT_RELEASE_NOTIFICATION_TYPE,
            source_id=release_id,
            title=str(fallback.get("title", "")),
            message=str(fallback.get("message", "")),
            translations=translations,
            url=str(release.get("url") or ""),
            important=bool(release.get("important", False)),
            replace_existing=True,
        )


async def poll_product_releases() -> None:
    """Attempt one due poll; all remote API failures are intentionally ignored."""
    now = _utc_now()
    last_attempted_at = await _load_last_attempted_at()
    if not _is_poll_due(last_attempted_at, now):
        return

    # Persist before making the request so failures and interrupted requests also
    # consume the 24-hour polling window.
    await _record_attempted_at(now)
    try:
        async with httpx.AsyncClient(timeout=PRODUCT_RELEASE_REQUEST_TIMEOUT_SECONDS) as client:
            response = await client.get(PRODUCT_RELEASE_API_URL)
            response.raise_for_status()
        body = response.json()
        result = body.get("result", {}) if isinstance(body, dict) else {}
        releases = result.get("releases", []) if isinstance(result, dict) else []
        if isinstance(releases, list):
            await _save_release_notifications(releases)
    except asyncio.CancelledError:
        raise
    except Exception as error:
        logger.debug("[product-releases] Poll failed and was ignored: %s", error)


async def _run_product_release_polling() -> None:
    assert _stop_event is not None
    while not _stop_event.is_set():
        try:
            await poll_product_releases()
        except asyncio.CancelledError:
            raise
        except Exception as error:
            logger.debug("[product-releases] Background poll skipped: %s", error)
        try:
            await asyncio.wait_for(
                _stop_event.wait(),
                timeout=PRODUCT_RELEASE_SCHEDULER_INTERVAL_SECONDS,
            )
        except TimeoutError:
            continue


def start_product_release_polling() -> None:
    global _polling_task, _stop_event
    if _polling_task and not _polling_task.done():
        return
    _stop_event = asyncio.Event()
    _polling_task = asyncio.create_task(
        _run_product_release_polling(),
        name="product-release-polling",
    )


async def stop_product_release_polling() -> None:
    global _polling_task, _stop_event
    if not _polling_task:
        return
    if _stop_event:
        _stop_event.set()
    await _polling_task
    _polling_task = None
    _stop_event = None
