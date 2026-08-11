from services.external_data.gov24 import normalize_application_deadline


def test_normalizes_explicit_application_end_dates():
    assert normalize_application_deadline("2025. 3. ~ 2025. 12.") == ("dated", "2025-12-31")
    assert normalize_application_deadline("2025.6.11.(수) 10:00 ~ 6. 24.(화)18:00") == (
        "dated",
        "2025-06-24",
    )
    assert normalize_application_deadline("2025년 3월 1일 ~ 2025년 5월 31일") == (
        "dated",
        "2025-05-31",
    )


def test_preserves_open_recurring_and_unknown_deadlines():
    assert normalize_application_deadline("상시신청") == ("always_open", None)
    assert normalize_application_deadline("매년 3~4월") == ("recurring", None)
    assert normalize_application_deadline("공고문 참조") == ("unknown", None)
