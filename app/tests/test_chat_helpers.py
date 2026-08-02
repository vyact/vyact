from routers.chat_helpers import unwrap_pasted_text


def test_unwrap_pasted_text_keeps_pasted_content_as_question():
    question = "\n\n«PASTE:뉴스 문단»\nThe Fed held rates steady.\n\n«/PASTE»"

    assert unwrap_pasted_text(question) == "The Fed held rates steady."


def test_unwrap_pasted_text_preserves_typed_question_and_paste_order():
    question = "분석해줘\n\n«PASTE:뉴스 문단»\nThe Fed held rates steady.\n\n«/PASTE»"

    assert unwrap_pasted_text(question) == "The Fed held rates steady.\n\n분석해줘"


def test_unwrap_pasted_text_keeps_multiple_chips_before_typed_question():
    question = (
        "이것도!\n\n"
        "«PASTE:첫 문단»\nFirst paragraph.\n«/PASTE»\n\n"
        "«PASTE:둘째 문단»\nSecond paragraph.\n«/PASTE»"
    )

    assert unwrap_pasted_text(question) == "First paragraph.\n\nSecond paragraph.\n\n이것도!"


def test_unwrap_pasted_text_restores_escaped_closing_marker_in_content():
    question = "«PASTE:텍스트»\nExample «\\/PASTE» text\n«/PASTE»"

    assert unwrap_pasted_text(question) == "Example «/PASTE» text"
