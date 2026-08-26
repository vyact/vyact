from services.conv_summary import HiddenMetadataStreamFilter, build_summary_instruction, extract_summary_tags
from services.project_memory import extract_project_memory_tag


def test_hides_conv_summary_when_tag_is_split_across_chunks():
    stream_filter = HiddenMetadataStreamFilter()

    visible = "".join([
        stream_filter.feed("Visible answer\n<con"),
        stream_filter.feed("v_summary>internal summary</conv_summary>"),
        stream_filter.finish(),
    ])

    assert visible == "Visible answer\n"


def test_flushes_a_non_metadata_partial_tag_at_end():
    stream_filter = HiddenMetadataStreamFilter()

    visible = stream_filter.feed("Comparison: <con") + stream_filter.finish()

    assert visible == "Comparison: <con"


def test_hides_project_metadata_tags():
    for tag_name in ("project_summary", "project_memory"):
        stream_filter = HiddenMetadataStreamFilter()

        visible = stream_filter.feed(f"Answer<{tag_name}>hidden")

        assert visible == "Answer"


def test_first_turn_requests_and_extracts_conversation_title():
    instruction = build_summary_instruction("", False)
    assert "<conv_title>" in instruction
    assert "at most 3–4 sentences" in instruction
    assert "End with <conv_summary>." in instruction

    clean, summary, project_summary, title = extract_summary_tags(
        "본문\n<conv_title>코드 변경 추적 테스트</conv_title>\n"
        "<conv_summary>파일 생성 테스트를 진행함.</conv_summary>"
    )

    assert clean == "본문"
    assert summary == "파일 생성 테스트를 진행함."
    assert project_summary is None
    assert title == "코드 변경 추적 테스트"


def test_followup_turn_does_not_request_a_new_title():
    instruction = build_summary_instruction("기존 요약", False)
    assert "<conv_title>" not in instruction


def test_malformed_project_memory_opening_is_removed():
    answer = '완료했습니다.\n<project_memory={"summary":"내부"}</project_memory>'

    clean_answer, memory = extract_project_memory_tag(answer)

    assert clean_answer == "완료했습니다."
    assert memory == {"summary": "내부"}
