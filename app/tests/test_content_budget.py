from services.content_budget import allocate_text_content_limits


def test_content_budget_redistributes_unused_short_text_share():
    contents = ["a" * 100, *("b" * 10_000 for _ in range(9))]

    limits = allocate_text_content_limits(contents, 30_000)

    assert limits[0] == 100
    assert limits[1:] == [3_323, 3_323, *([3_322] * 7)]
    assert sum(limits) == 30_000


def test_content_budget_keeps_short_texts_complete_regardless_of_order():
    contents = ["a" * 30_000, "b" * 30, "c" * 10_000]

    limits = allocate_text_content_limits(contents, 30_000)

    assert limits == [19_970, 30, 10_000]
