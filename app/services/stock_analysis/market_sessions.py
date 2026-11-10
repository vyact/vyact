"""Exchange session windows, including holidays, breaks and daylight saving time."""
from datetime import datetime, timedelta
from functools import lru_cache
import warnings

import pandas_market_calendars as market_calendars

CASH_CALENDAR = "NYSE"
FUTURES_CALENDAR = "CME Globex Equity"
JAPAN_CASH_CALENDAR = "JPX"


@lru_cache(maxsize=8)
def _calendar(calendar_name: str):
    if calendar_name == "XKRX":
        # Construction warns before we can remove the obsolete break times.
        # Suppress only this known warning, only while building this calendar.
        with warnings.catch_warnings():
            warnings.filterwarnings(
                "ignore", category=UserWarning,
                message=r"\['break_start', 'break_end'\] are discontinued,.*",
                module=r"pandas_market_calendars\.market_calendar",
            )
            calendar = market_calendars.get_calendar(calendar_name)
        # Korean equities no longer have the historical lunch break.
        for market_time in ("break_start", "break_end"):
            if market_time in calendar.regular_market_times:
                calendar.remove_time(market_time)
        return calendar
    return market_calendars.get_calendar(calendar_name)


def _local_day(calendar_name: str, now: float) -> str:
    return datetime.fromtimestamp(now, _calendar(calendar_name).tz).date().isoformat()


@lru_cache(maxsize=8)
def _daily_schedule(calendar_name: str, local_day: str):
    day = datetime.fromisoformat(local_day).date()
    return _calendar(calendar_name).schedule(start_date=day - timedelta(days=1), end_date=day + timedelta(days=1))


def us_premarket_window(now: float) -> tuple[float, float] | None:
    """NYSE trading-day premarket window; excludes holidays and respects DST."""
    calendar = _calendar(CASH_CALENDAR)
    local = datetime.fromtimestamp(now, calendar.tz)
    start = local.replace(hour=4, minute=0, second=0, microsecond=0).timestamp()
    for opening in _daily_schedule(CASH_CALENDAR, local.date().isoformat())['market_open']:
        if opening.tz_convert(calendar.tz).date() == local.date() and start <= now < opening.timestamp():
            return start, opening.timestamp()
    return None


@lru_cache(maxsize=8)
def _session_windows(calendar_name: str, local_day: str) -> tuple[tuple[float, float], ...]:
    schedule = _daily_schedule(calendar_name, local_day)
    windows = []
    for _, row in schedule.iterrows():
        start, end = row["market_open"].timestamp(), row["market_close"].timestamp()
        if "break_start" in row and row["break_start"] < row["market_close"]:
            windows.extend(((start, row["break_start"].timestamp()), (row["break_end"].timestamp(), end)))
        else:
            windows.append((start, end))
    return tuple(windows)


def active_session(calendar_name: str, now: float) -> tuple[float, float] | None:
    local_day = _local_day(calendar_name, now)
    return next(((start, end) for start, end in _session_windows(calendar_name, local_day)
                 if start <= now < end), None)


@lru_cache(maxsize=4)
def _cash_openings(local_day: str, calendar_name: str = CASH_CALENDAR) -> tuple[float, ...]:
    day = datetime.fromisoformat(local_day).date()
    schedule = _calendar(calendar_name).schedule(
        start_date=day, end_date=day + timedelta(days=14),
    )
    return tuple(value.timestamp() for value in schedule["market_open"])


def next_regular_open(now: float, calendar_name: str = CASH_CALENDAR) -> float | None:
    local_day = _local_day(calendar_name, now)
    return next((opening for opening in _cash_openings(local_day, calendar_name) if opening > now), None)


def is_session_break(calendar_name: str, now: float) -> bool:
    schedule = _daily_schedule(calendar_name, _local_day(calendar_name, now))
    if "break_start" not in schedule or "break_end" not in schedule:
        return False
    return any(row["break_start"].timestamp() <= now < row["break_end"].timestamp()
               for _, row in schedule.iterrows())
