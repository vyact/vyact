from routers.backup import _expand_selected_indices, _logical_index_name


def test_language_indices_share_one_logical_backup_name():
    assert _logical_index_name("doc_chunks_ko") == "doc_chunks"
    assert _logical_index_name("doc_chunks_en") == "doc_chunks"
    assert _logical_index_name("system_settings") == "system_settings"


def test_selecting_logical_name_expands_every_language_index():
    available = ["doc_chunks_ko", "doc_chunks_en", "doc_chunks_und", "system_settings"]

    assert _expand_selected_indices(["doc_chunks"], available) == available[:3]
    assert _expand_selected_indices(["system_settings"], available) == ["system_settings"]
