from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock

import pytest

from services.microsoft_workspace import calendar_notifications as notifications


@pytest.mark.asyncio
async def test_due_reminder_pagination_and_no_repeat(monkeypatch):
    now = datetime(2026, 9, 5, 21, tzinfo=timezone.utc)
    event = {'id': 'event', 'subject': 'Meeting', 'start': {'dateTime': '2026-09-05T21:30:00.0000000'},
             'isReminderOn': True, 'reminderMinutesBeforeStart': 30}
    graph = AsyncMock(side_effect=[
        {'value': [], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/calendarView?$skip=1'},
        {'value': [event, {**event, 'id': 'off', 'isReminderOn': False},
                   {**event, 'id': 'cancelled', 'isCancelled': True}]},
        {'value': [event]},
    ])
    create = AsyncMock()
    monkeypatch.setattr(notifications, 'graph', graph)
    monkeypatch.setattr(notifications, 'create_notification', create)
    monkeypatch.setattr(notifications, '_known', {})
    monkeypatch.setattr(notifications, '_last_checked', {})
    await notifications._collect_account('account', 'a@example.com', now)
    await notifications._collect_account('account', 'a@example.com', now + timedelta(seconds=10))
    create.assert_awaited_once()
    payload = create.call_args.kwargs
    assert payload['occurred_at'] == now.isoformat()
    assert payload['account_id'] == 'account'
    assert payload['notification_type'] == 'microsoft_calendar'
    assert all(call.kwargs['account_id'] == 'account' for call in graph.call_args_list)


@pytest.mark.asyncio
async def test_calendar_independent_of_mail_and_account_failure(monkeypatch):
    monkeypatch.setattr(notifications, 'status', AsyncMock(return_value={
        'accounts': [{'id': 'a', 'authenticated': True}, {'id': 'b', 'authenticated': True},
                     {'id': 'c', 'authenticated': False}],
        'config': {'accounts': [{'id': 'a', 'mail_notifications': False}]},
    }))
    collect = AsyncMock(side_effect=[RuntimeError('offline'), None])
    monkeypatch.setattr(notifications, '_collect_account', collect)
    await notifications.collect_microsoft_calendar_notifications()
    assert [call.args[0] for call in collect.call_args_list] == ['a', 'b']


@pytest.mark.asyncio
async def test_future_and_old_reminders_not_emitted_on_startup(monkeypatch):
    now = datetime(2026, 9, 5, 21, tzinfo=timezone.utc)
    events = [{'id': str(minutes), 'start': {'dateTime': '2026-09-05T21:30:00Z'},
               'isReminderOn': True, 'reminderMinutesBeforeStart': minutes} for minutes in (15, 60)]
    monkeypatch.setattr(notifications, 'graph', AsyncMock(return_value={'value': events}))
    create = AsyncMock()
    monkeypatch.setattr(notifications, 'create_notification', create)
    monkeypatch.setattr(notifications, '_known', {})
    monkeypatch.setattr(notifications, '_last_checked', {})
    await notifications._collect_account('account', '', now)
    create.assert_not_awaited()
