from datetime import datetime
from unittest.mock import patch
import warnings

import pandas_market_calendars as market_calendars

import pytest

from services.stock_analysis.market_sessions import CASH_CALENDAR, FUTURES_CALENDAR, active_session, next_regular_open, JAPAN_CASH_CALENDAR, is_session_break, _calendar


def stamp(value):
    return datetime.fromisoformat(value).timestamp()


def test_korean_and_us_comparison_refreshes_only_open_market():
    now = stamp('2026-11-09T10:00:00-05:00')
    assert active_session(CASH_CALENDAR, now)
    assert active_session('XKRX', now) is None
    assert active_session('XKRX', stamp('2026-11-09T12:00:00+09:00'))
    assert active_session('XKRX', stamp('2026-11-09T15:30:00+09:00')) is None


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


def test_japan_lunch_break_and_next_open():
    assert active_session(JAPAN_CASH_CALENDAR, stamp('2026-11-09T11:29:00+09:00'))
    assert is_session_break(JAPAN_CASH_CALENDAR, stamp('2026-11-09T11:30:00+09:00'))
    assert is_session_break(JAPAN_CASH_CALENDAR, stamp('2026-11-09T12:29:00+09:00'))
    assert not is_session_break(JAPAN_CASH_CALENDAR, stamp('2026-11-09T12:30:00+09:00'))
    assert next_regular_open(stamp('2026-11-09T18:00:00+09:00'), JAPAN_CASH_CALENDAR) == stamp('2026-11-10T09:00:00+09:00')
    assert next_regular_open(stamp('2026-11-20T18:00:00+09:00'), JAPAN_CASH_CALENDAR) == stamp('2026-11-24T09:00:00+09:00')


def test_korean_calendar_suppresses_only_handled_discontinued_break_warning():
    with warnings.catch_warnings(record=True) as captured:
        warnings.simplefilter('always')
        calendar = _calendar.__wrapped__('XKRX')
    assert not any('are discontinued' in str(item.message) for item in captured)
    assert 'break_start' not in calendar.regular_market_times
    assert 'break_end' not in calendar.regular_market_times


def test_korean_calendar_preserves_unrelated_warnings():
    original_get = market_calendars.get_calendar

    def get_with_unrelated_warning(name):
        warnings.warn('unrelated calendar warning', UserWarning)
        return original_get(name)

    with patch.object(market_calendars, 'get_calendar', side_effect=get_with_unrelated_warning):
        with pytest.warns(UserWarning, match='unrelated calendar warning'):
            _calendar.__wrapped__('XKRX')
