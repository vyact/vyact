"""Background collectors that persist external notifications in Elasticsearch."""
import asyncio
from collections.abc import Awaitable, Callable
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from googleapiclient.errors import HttpError

from logger import get_logger
from services.google_workspace.auth import (
    _build_service,
    get_auth_status,
)
from services.google_workspace.gmail import list_mail_messages_sync
from services.mcp_config import list_servers
from services.notifications import create_notification, has_notification_type

logger = get_logger(__name__)

NOTIFICATION_COLLECTION_INTERVAL_SECONDS = 10
GMAIL_PAGE_SIZE = 30
CALENDAR_PAGE_SIZE = 250
MAX_CALENDAR_REMINDER_MINUTES = 40_320
CALENDAR_NOTIFICATION_LOOKBACK_SECONDS = NOTIFICATION_COLLECTION_INTERVAL_SECONDS * 2
PRIMARY_CALENDAR_ID = "primary"

NotificationCollector = Callable[[], Awaitable[None]]
AccountNotificationCollector = Callable[[dict], Awaitable[None]]

_polling_task: asyncio.Task | None = None
_stop_event: asyncio.Event | None = None
_wake_event: asyncio.Event | None = None
_known_gmail_message_ids: dict[str, set[str]] = {}
_gmail_initialized_accounts: set[str] = set()
_calendar_last_checked_at: dict[str, datetime] = {}
_known_calendar_reminder_ids: dict[str, set[str]] = {}
_calendar_initialized_accounts: set[str] = set()


def _notification_account_log_label(account: dict) -> str:
    """Return a privacy-friendly account label for polling logs."""
    account_email = account.get("account_email", "")
    if isinstance(account_email, str) and "@" in account_email:
        return account_email.split("@", 1)[0]
    return account_email or account.get("id", "unknown")


async def _notification_accounts() -> list[dict]:
    google_server = next(
        (
            server
            for server in await list_servers()
            if server.get("type") == "google_workspace"
        ),
        None,
    )
    accounts = ((google_server or {}).get("config") or {}).get("accounts", [])
    if not isinstance(accounts, list):
        return []
    status_by_id = {
        status["id"]: status
        for status in (await get_auth_status()).get("accounts", [])
    }
    return [
        {
            **account,
            "account_email": status_by_id.get(account.get("id"), {}).get("email", ""),
        }
        for account in accounts
        if account.get("id")
        and account.get("mail_notifications")
        and status_by_id.get(account.get("id"), {}).get("authenticated")
    ]


async def _collect_for_accounts(
    accounts: list[dict],
    collector: AccountNotificationCollector,
) -> None:
    results = await asyncio.gather(
        *(collector(account) for account in accounts),
        return_exceptions=True,
    )
    for account, result in zip(accounts, results):
        if isinstance(result, asyncio.CancelledError):
            raise result
        if isinstance(result, Exception):
            logger.warning(
                "[notifications] %s failed for account=%s: %s",
                collector.__name__,
                _notification_account_log_label(account),
                result,
            )


async def collect_google_mail_notifications() -> None:
    """Collect new Gmail messages when mail notifications are enabled."""
    accounts = await _notification_accounts()
    active_ids = {account["id"] for account in accounts}
    for account_id in set(_known_gmail_message_ids) - active_ids:
        _known_gmail_message_ids.pop(account_id, None)
        _gmail_initialized_accounts.discard(account_id)
    await _collect_for_accounts(accounts, _collect_google_mail_notifications_for_account)


async def _collect_google_mail_notifications_for_account(account: dict) -> None:
    account_id = account["id"]
    service = await _build_service("gmail", "v1", account_id=account_id)
    try:
        result = await _list_latest_gmail_messages(service)
    except HttpError as error:
        if error.resp.status != 401:
            raise
        logger.info(
            "[notifications] Gmail token rejected; refreshing and retrying: account=%s",
            _notification_account_log_label(account),
        )
        service = await _build_service("gmail", "v1", force_refresh=True, account_id=account_id)
        result = await _list_latest_gmail_messages(service)
    messages = result["messages"]
    current_ids = {message["id"] for message in messages}

    if account_id not in _gmail_initialized_accounts:
        has_existing_mail_notifications = await has_notification_type("google_mail", account_id)
        _known_gmail_message_ids[account_id] = set() if has_existing_mail_notifications else current_ids
        _gmail_initialized_accounts.add(account_id)

    new_messages = [
        message for message in messages
        if message.get("isUnread")
        and message["id"] not in _known_gmail_message_ids.get(account_id, set())
    ]
    saved_count = 0
    for message in new_messages:
        created = await create_notification(
            notification_type="google_mail",
            source_id=message["id"],
            title=message["subject"] or "제목 없음",
            message=message["from"],
            occurred_at=message["receivedAt"],
            account_id=account_id,
            account_email=account.get("account_email", ""),
        )
        if created:
            saved_count += 1

    _known_gmail_message_ids[account_id] = current_ids
    if saved_count:
        logger.info(
            "[notifications] Gmail notifications saved: account=%s, saved=%d",
            _notification_account_log_label(account),
            saved_count,
        )


async def _list_latest_gmail_messages(service) -> dict:
    return await asyncio.to_thread(
        list_mail_messages_sync,
        service,
        "INBOX",
        "",
        "",
        GMAIL_PAGE_SIZE,
    )


def _parse_calendar_start(event: dict, calendar_timezone: str) -> datetime | None:
    start = event.get("start") or {}
    date_time_value = start.get("dateTime")
    if date_time_value:
        try:
            parsed_date_time = datetime.fromisoformat(date_time_value.replace("Z", "+00:00"))
            if parsed_date_time.tzinfo is not None:
                return parsed_date_time
            try:
                event_zone = ZoneInfo(start.get("timeZone") or calendar_timezone)
            except (ZoneInfoNotFoundError, ValueError):
                event_zone = timezone.utc
            return parsed_date_time.replace(tzinfo=event_zone)
        except ValueError:
            return None

    date_value = start.get("date")
    if not date_value:
        return None
    try:
        calendar_date = date.fromisoformat(date_value)
        try:
            calendar_zone = ZoneInfo(calendar_timezone)
        except (ZoneInfoNotFoundError, ValueError):
            calendar_zone = timezone.utc
        return datetime.combine(calendar_date, time.min, tzinfo=calendar_zone)
    except ValueError:
        return None


def _effective_calendar_reminder_minutes(
    event: dict,
    default_reminders: list[dict],
) -> list[int]:
    event_reminders = event.get("reminders")
    if event_reminders and event_reminders.get("useDefault") is False:
        reminders = event_reminders.get("overrides") or []
    else:
        reminders = default_reminders

    valid_minutes = {
        reminder.get("minutes")
        for reminder in reminders
        if isinstance(reminder.get("minutes"), int)
        and 0 <= reminder["minutes"] <= MAX_CALENDAR_REMINDER_MINUTES
    }
    return sorted(valid_minutes, reverse=True)


def _list_calendar_events_sync(service, time_min: str, time_max: str) -> tuple[list[dict], list[dict], str]:
    events: list[dict] = []
    default_reminders: list[dict] = []
    calendar_timezone = "UTC"
    page_token: str | None = None

    while True:
        result = service.events().list(
            calendarId=PRIMARY_CALENDAR_ID,
            timeMin=time_min,
            timeMax=time_max,
            maxResults=CALENDAR_PAGE_SIZE,
            singleEvents=True,
            orderBy="startTime",
            pageToken=page_token,
        ).execute()
        events.extend(result.get("items", []))
        if not default_reminders:
            default_reminders = result.get("defaultReminders", [])
        calendar_timezone = result.get("timeZone") or calendar_timezone
        page_token = result.get("nextPageToken")
        if not page_token:
            return events, default_reminders, calendar_timezone


def _calendar_notification_message(event: dict, start_at: datetime) -> str:
    location = (event.get("location") or "").strip()
    start_text = start_at.strftime("%Y-%m-%d %H:%M")
    return f"{start_text} · {location}" if location else start_text


async def collect_google_calendar_notifications() -> None:
    """Create in-app notifications from effective Google Calendar reminders."""
    accounts = await _notification_accounts()
    active_ids = {account["id"] for account in accounts}
    for account_id in set(_known_calendar_reminder_ids) - active_ids:
        _known_calendar_reminder_ids.pop(account_id, None)
        _calendar_last_checked_at.pop(account_id, None)
        _calendar_initialized_accounts.discard(account_id)
    await _collect_for_accounts(accounts, _collect_google_calendar_notifications_for_account)


async def _collect_google_calendar_notifications_for_account(account: dict) -> None:
    account_id = account["id"]
    now = datetime.now(timezone.utc)
    lookback_start = now - timedelta(seconds=CALENDAR_NOTIFICATION_LOOKBACK_SECONDS)
    notification_window_start = max(
        _calendar_last_checked_at.get(account_id) or lookback_start,
        lookback_start,
    )
    query_time_min = (now - timedelta(minutes=1)).isoformat()
    query_time_max = (now + timedelta(minutes=MAX_CALENDAR_REMINDER_MINUTES)).isoformat()

    service = await _build_service("calendar", "v3", account_id=account_id)
    try:
        events, default_reminders, calendar_timezone = await asyncio.to_thread(
            _list_calendar_events_sync,
            service,
            query_time_min,
            query_time_max,
        )
    except HttpError as error:
        if error.resp.status != 401:
            raise
        service = await _build_service("calendar", "v3", force_refresh=True, account_id=account_id)
        events, default_reminders, calendar_timezone = await asyncio.to_thread(
            _list_calendar_events_sync,
            service,
            query_time_min,
            query_time_max,
        )

    saved_count = 0
    current_reminder_ids: set[str] = set()
    was_initialized = account_id in _calendar_initialized_accounts
    for event in events:
        if event.get("status") == "cancelled":
            continue
        start_at = _parse_calendar_start(event, calendar_timezone)
        if start_at is None:
            continue
        start_at_utc = start_at.astimezone(timezone.utc)
        for reminder_minutes in _effective_calendar_reminder_minutes(event, default_reminders):
            trigger_at = start_at_utc - timedelta(minutes=reminder_minutes)
            event_id = event.get("id")
            if not event_id:
                continue
            source_id = f"{PRIMARY_CALENDAR_ID}:{event_id}:{start_at_utc.isoformat()}:{reminder_minutes}"
            current_reminder_ids.add(source_id)
            is_scheduled_now = notification_window_start < trigger_at <= now
            is_new_overdue_reminder = (
                was_initialized
                and source_id not in _known_calendar_reminder_ids.get(account_id, set())
                and trigger_at <= now < start_at_utc
            )
            if not is_scheduled_now and not is_new_overdue_reminder:
                continue
            created = await create_notification(
                notification_type="google_calendar",
                source_id=source_id,
                title=event.get("summary") or "제목 없는 일정",
                message=_calendar_notification_message(event, start_at),
                occurred_at=trigger_at.isoformat().replace("+00:00", "Z"),
                account_id=account_id,
                account_email=account.get("account_email", ""),
            )
            if created:
                saved_count += 1

    _calendar_last_checked_at[account_id] = now
    _known_calendar_reminder_ids[account_id] = current_reminder_ids
    _calendar_initialized_accounts.add(account_id)
    if saved_count:
        logger.info(
            "[notifications] Calendar notifications saved: account=%s, saved=%d",
            _notification_account_log_label(account),
            saved_count,
        )


NOTIFICATION_COLLECTORS: tuple[NotificationCollector, ...] = (
    collect_google_mail_notifications,
    collect_google_calendar_notifications,
)


async def _run_notification_collectors() -> None:
    assert _stop_event is not None and _wake_event is not None
    while not _stop_event.is_set():
        for collector in NOTIFICATION_COLLECTORS:
            try:
                await collector()
            except asyncio.CancelledError:
                raise
            except Exception as error:
                logger.warning(
                    "[notifications] %s failed: %s",
                    collector.__name__,
                    error,
                )

        try:
            await asyncio.wait_for(
                _wake_event.wait(),
                timeout=NOTIFICATION_COLLECTION_INTERVAL_SECONDS,
            )
            _wake_event.clear()
        except TimeoutError:
            continue


def start_notification_polling() -> None:
    global _polling_task, _stop_event, _wake_event
    if _polling_task and not _polling_task.done():
        return
    _stop_event = asyncio.Event()
    _wake_event = asyncio.Event()
    _polling_task = asyncio.create_task(
        _run_notification_collectors(),
        name="notification-polling",
    )
    logger.info(
        "[notifications] background polling started (%ss)",
        NOTIFICATION_COLLECTION_INTERVAL_SECONDS,
    )


def request_notification_poll() -> None:
    """Wake the collector after an external connection or setting change."""
    if _polling_task and not _polling_task.done() and _wake_event:
        _wake_event.set()


async def stop_notification_polling() -> None:
    global _polling_task, _stop_event, _wake_event
    if not _polling_task:
        return
    if _stop_event:
        _stop_event.set()
    if _wake_event:
        _wake_event.set()
    await _polling_task
    _polling_task = None
    _stop_event = None
    _wake_event = None
    logger.info("[notifications] background polling stopped")
