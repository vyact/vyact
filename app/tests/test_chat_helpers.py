from routers.chat_helpers import (
    build_injected_context,
    DIRECT_DOCUMENT_TOTAL_MAX_CHARS,
    build_assistant_message,
    limit_direct_document_contexts,
    unwrap_pasted_text,
)


def test_build_injected_context_preserves_external_data_origin():
    context = build_injected_context([{
        "source": "BizInfo",
        "title": "지원 사업",
        "content": "사업 내용",
        "context_origin": "external_data",
    }])

    assert context == [{
        "source": "BizInfo",
        "title": "지원 사업",
        "data": "사업 내용",
        "context_origin": "external_data",
        "external_document": {
            "id": None, "external_resource_id": None, "url": None,
            "source_modified_at": None, "application_deadline": None,
            "application_end_date": None, "deadline_kind": None,
            "agency": None, "target": None, "category": None,
            "user_type": None, "support_type": None, "summary": None,
            "purpose": None, "selection_criteria": None,
            "application_method": None, "required_documents": None,
            "contact": None, "attachments": None, "record_type": None,
            "application_url": None, "created_at": None, "view_count": None,
        },
    }]


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


def test_build_assistant_message_persists_output_truncation():
    message = build_assistant_message("partial answer", "gpt-test", truncated=True)

    assert message["truncated"] is True


def test_build_assistant_message_omits_truncation_when_complete():
    message = build_assistant_message("complete answer", "gpt-test")

    assert "truncated" not in message


def test_build_assistant_message_persists_error_state():
    message = build_assistant_message("", "gpt-test", error_code="model_no_response")

    assert message["isError"] is True
    assert message["errorCode"] == "model_no_response"


def test_direct_document_limit_is_shared_across_all_direct_documents():
    documents = [
        {"content": "a" * DIRECT_DOCUMENT_TOTAL_MAX_CHARS, "direct_document": True},
        {"content": "b" * DIRECT_DOCUMENT_TOTAL_MAX_CHARS, "direct_document": True},
    ]

    limited = limit_direct_document_contexts(documents)

    assert sum(len(document["content"]) for document in limited) == DIRECT_DOCUMENT_TOTAL_MAX_CHARS


def test_direct_document_limit_redistributes_unused_short_document_budget():
    documents = [
        {"content": "a" * 30, "direct_document": True},
        {"content": "b" * DIRECT_DOCUMENT_TOTAL_MAX_CHARS, "direct_document": True},
    ]

    limited = limit_direct_document_contexts(documents)

    assert len(limited[0]["content"]) == 30
    assert len(limited[1]["content"]) == DIRECT_DOCUMENT_TOTAL_MAX_CHARS - 30


def test_direct_document_limit_redistributes_multiple_short_documents():
    documents = [
        {"content": "a" * 30, "direct_document": True},
        {"content": "b" * 10_000, "direct_document": True},
        {"content": "c" * DIRECT_DOCUMENT_TOTAL_MAX_CHARS, "direct_document": True},
    ]

    limited = limit_direct_document_contexts(documents)

    assert [len(document["content"]) for document in limited] == [30, 10_000, 19_970]
