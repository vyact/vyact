from datetime import datetime

import pytest

from services.stock_analysis.market_sessions import CASH_CALENDAR, FUTURES_CALENDAR, active_session, next_regular_open


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


@pytest.mark.parametrize('value,cash,futures', [
    ('2026-11-09T09:29:00-05:00', False, True),
    ('2026-11-09T09:30:00-05:00', True, True),
    ('2026-11-09T16:00:00-05:00', False, True),
    ('2026-11-09T16:15:00-05:00', False, True),
    ('2026-11-09T16:30:00-05:00', False, True),
    ('2026-11-09T17:00:00-05:00', False, False),
    ('2026-11-09T17:59:00-05:00', False, False),
    ('2026-11-09T18:00:00-05:00', False, True),
    ('2026-11-06T18:00:00-05:00', False, False),
    ('2026-11-07T12:00:00-05:00', False, False),
    ('2026-11-08T17:59:00-05:00', False, False),
    ('2026-11-08T18:00:00-05:00', False, True),
    ('2026-07-06T09:30:00-04:00', True, True),
    ('2026-07-06T17:30:00-04:00', False, False),
    ('2026-07-06T18:00:00-04:00', False, True),
    ('2026-12-25T10:00:00-05:00', False, False),
    ('2026-11-27T13:00:00-05:00', False, True),
    ('2026-11-27T14:00:00-05:00', False, False),
])
def test_exchange_sessions(value, cash, futures):
    now = stamp(value)
    assert bool(active_session(CASH_CALENDAR, now)) is cash
    assert bool(active_session(FUTURES_CALENDAR, now)) is futures


@pytest.mark.parametrize('now,expected', [
    ('2026-11-09T09:00:00-05:00', '2026-11-09T09:30:00-05:00'),
    ('2026-11-06T17:30:00-05:00', '2026-11-09T09:30:00-05:00'),
    ('2026-11-26T10:00:00-05:00', '2026-11-27T09:30:00-05:00'),
    ('2026-03-06T18:00:00-05:00', '2026-03-09T09:30:00-04:00'),
])
def test_next_regular_open_skips_closed_days_and_handles_dst(now, expected):
    assert next_regular_open(stamp(now)) == stamp(expected)
