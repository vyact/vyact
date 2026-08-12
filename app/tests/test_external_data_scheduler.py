from datetime import datetime, timezone

from services.external_data.scheduler import is_sync_due


def test_sync_is_due_when_last_success_is_missing():
    assert is_sync_due(None, 3)


def test_sync_is_due_after_configured_interval():
    now = datetime(2026, 8, 12, 12, 0, tzinfo=timezone.utc)
    assert is_sync_due("2026-08-12T08:00:00+00:00", 3, now)


def test_sync_is_not_due_before_configured_interval():
    now = datetime(2026, 8, 12, 10, 0, tzinfo=timezone.utc)
    assert not is_sync_due("2026-08-12T08:00:00+00:00", 3, now)
