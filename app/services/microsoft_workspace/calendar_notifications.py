"""Collect Outlook calendar reminders independently of mail preferences."""
import logging
from datetime import datetime, timedelta, timezone

from services.microsoft_workspace.auth import graph, status
from services.microsoft_workspace.mail import page_path
from services.notifications import create_notification

logger = logging.getLogger(__name__)
LOOKBACK_SECONDS = 20
MAX_REMINDER_MINUTES = 40_320
_last_checked: dict[str, datetime] = {}
_known: dict[str, set[str]] = {}


async def collect_microsoft_calendar_notifications() -> None:
    state = await status()
    accounts = {item['id']: item for item in state['accounts'] if item['authenticated']}
    for account_id in set(_last_checked) - accounts.keys():
        _last_checked.pop(account_id, None)
        _known.pop(account_id, None)
    for account_id, account in accounts.items():
        try:
            await _collect_account(account_id, account.get('email', ''), datetime.now(timezone.utc))
        except Exception:
            logger.exception('Microsoft calendar notification collection failed')


async def _collect_account(account_id: str, email: str, now: datetime) -> None:
    window_start = max(_last_checked.get(account_id, now - timedelta(seconds=LOOKBACK_SECONDS)),
                       now - timedelta(seconds=LOOKBACK_SECONDS))
    data = await graph('/me/calendarView', account_id=account_id, params={
        'startDateTime': (now - timedelta(minutes=1)).isoformat(),
        'endDateTime': (now + timedelta(minutes=MAX_REMINDER_MINUTES)).isoformat(),
        '$top': '250',
        '$select': 'id,subject,start,isCancelled,isReminderOn,reminderMinutesBeforeStart,location',
    })
    known = set()
    while True:
        for event in data.get('value', []):
            minutes = event.get('reminderMinutesBeforeStart')
            if (event.get('isCancelled') or not event.get('isReminderOn') or not event.get('id')
                    or type(minutes) is not int or not 0 <= minutes <= MAX_REMINDER_MINUTES):
                continue
            try:
                # Graph returns UTC when no outlook.timezone preference is supplied.
                start = datetime.fromisoformat(event['start']['dateTime'].replace('Z', '+00:00'))
                if start.tzinfo is None:
                    start = start.replace(tzinfo=timezone.utc)
                start = start.astimezone(timezone.utc)
            except (KeyError, TypeError, ValueError):
                continue
            trigger = start - timedelta(minutes=minutes)
            source_id = f"primary:{event['id']}:{start.isoformat()}:{minutes}"
            known.add(source_id)
            newly_overdue = account_id in _known and source_id not in _known[account_id] and trigger <= now < start
            if not window_start < trigger <= now and not newly_overdue:
                continue
            await create_notification(
                notification_type='microsoft_calendar', source_id=source_id,
                title=event.get('subject') or '',
                message=(event.get('location') or {}).get('displayName', ''),
                occurred_at=trigger.isoformat(), account_id=account_id, account_email=email,
            )
        next_link = data.get('@odata.nextLink')
        if not next_link:
            break
        data = await graph(page_path(next_link, '/me/'), account_id=account_id)
    _known[account_id] = known
    _last_checked[account_id] = now
