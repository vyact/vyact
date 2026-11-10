from datetime import date, datetime, timezone

from services.external_data.messages import get_all_searches_failed_message
from services.external_data.retention import is_storable_by_deadline
from services.external_data.scheduler import is_sync_due


def test_external_failure_message_uses_ui_language() -> None:
    assert "외부 데이터" in get_all_searches_failed_message("ko-KR")
    assert "external data" in get_all_searches_failed_message("en-US")


def test_rejects_known_expired_deadline() -> None:
    assert not is_storable_by_deadline(
        {"application_end_date": "2026-08-14"},
        today=date(2026, 8, 15),
    )


def test_keeps_deadline_that_ends_today() -> None:
    assert is_storable_by_deadline(
        {"application_end_date": "2026-08-15"},
        today=date(2026, 8, 15),
    )


def test_keeps_unknown_or_unparseable_deadline() -> None:
    assert is_storable_by_deadline({}, today=date(2026, 8, 15))
    assert is_storable_by_deadline(
        {"application_end_date": "상시 신청"},
        today=date(2026, 8, 15),
    )


def test_sync_is_due_when_last_success_is_missing():
    assert is_sync_due(None, 3)


def test_sync_is_due_after_configured_interval():
    now = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
    assert is_sync_due("2026-08-12T08:00:00+00:00", 3, now)


def test_sync_is_not_due_before_configured_interval():
    now = datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc)
    assert not is_sync_due("2026-08-12T08:00:00+00:00", 3, now)
