"""Retention rules shared by external-data collectors."""

from datetime import date, datetime

from services.external_data.quota import KOREA_TIMEZONE


def is_storable_by_deadline(document: dict, today: date | None = None) -> bool:
    """Keep unknown deadlines and reject only documents known to be expired."""
    deadline = document.get("application_end_date")
    if deadline in (None, ""):
        return True
    if isinstance(deadline, datetime):
        deadline_date = deadline.date()
    elif isinstance(deadline, date):
        deadline_date = deadline
    else:
        try:
            deadline_date = date.fromisoformat(str(deadline).strip()[:10])
        except (TypeError, ValueError):
            return True
    current_date = today or datetime.now(KOREA_TIMEZONE).date()
    return deadline_date >= current_date
