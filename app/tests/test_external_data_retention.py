from datetime import date

from services.external_data.retention import is_storable_by_deadline


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
