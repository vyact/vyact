from services.external_data.messages import get_all_searches_failed_message


def test_external_failure_message_uses_ui_language() -> None:
    assert "외부 데이터" in get_all_searches_failed_message("ko-KR")
    assert "external data" in get_all_searches_failed_message("en-US")
