"""Exchange session windows, including holidays, breaks and daylight saving time."""
from datetime import datetime, timedelta
from functools import lru_cache
from zoneinfo import ZoneInfo

import pandas_market_calendars as market_calendars

EXCHANGE_TIMEZONE = ZoneInfo("America/New_York")
CASH_CALENDAR = "NYSE"
FUTURES_CALENDAR = "CME Globex Equity"


@lru_cache(maxsize=8)
def _session_windows(calendar_name: str, local_day: str) -> tuple[tuple[float, float], ...]:
    day = datetime.fromisoformat(local_day).date()
    calendar = market_calendars.get_calendar(calendar_name)
    schedule = calendar.schedule(start_date=day - timedelta(days=1), end_date=day + timedelta(days=1))
    windows = []
    for _, row in schedule.iterrows():
        start, end = row["market_open"].timestamp(), row["market_close"].timestamp()
        if "break_start" in row and row["break_start"] < row["market_close"]:
            windows.extend(((start, row["break_start"].timestamp()), (row["break_end"].timestamp(), end)))
        else:
            windows.append((start, end))
    return tuple(windows)


def active_session(calendar_name: str, now: float) -> tuple[float, float] | None:
    local_day = datetime.fromtimestamp(now, EXCHANGE_TIMEZONE).date().isoformat()
    return next(((start, end) for start, end in _session_windows(calendar_name, local_day)
                 if start <= now < end), None)


@lru_cache(maxsize=4)
def _cash_openings(local_day: str) -> tuple[float, ...]:
    day = datetime.fromisoformat(local_day).date()
    schedule = market_calendars.get_calendar(CASH_CALENDAR).schedule(
        start_date=day, end_date=day + timedelta(days=14),
    )
    return tuple(value.timestamp() for value in schedule["market_open"])


def next_regular_open(now: float) -> float | None:
    local_day = datetime.fromtimestamp(now, EXCHANGE_TIMEZONE).date().isoformat()
    return next((opening for opening in _cash_openings(local_day) if opening > now), None)
