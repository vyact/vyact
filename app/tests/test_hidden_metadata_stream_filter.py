from services.conv_summary import HiddenMetadataStreamFilter


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
