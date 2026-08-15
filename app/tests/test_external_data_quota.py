from datetime import datetime

import pytest

from services.external_data.quota import (
    KOREA_TIMEZONE,
    DailyRequestQuota,
    DailyRequestQuotaExceededError,
)


def test_quota_keeps_request_count_from_same_korea_date() -> None:
    request_date = datetime.now(KOREA_TIMEZONE).date().isoformat()

    quota = DailyRequestQuota.from_status(
        {"request_date": request_date, "request_count": 37},
        100,
    )

    assert quota.used == 37
    assert quota.status_fields() == {
        "request_count": 37,
        "request_limit": 100,
        "request_date": request_date,
    }


def test_quota_resets_request_count_from_previous_date() -> None:
    quota = DailyRequestQuota.from_status(
        {"request_date": "2000-01-01", "request_count": 99},
        100,
    )

    assert quota.used == 0


def test_quota_blocks_before_exceeding_daily_limit() -> None:
    quota = DailyRequestQuota(limit=2, used=1, request_date="2026-08-15")

    quota.consume()

    with pytest.raises(DailyRequestQuotaExceededError):
        quota.consume()
    assert quota.used == 2
