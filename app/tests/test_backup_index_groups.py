from routers.backup import _BACKUP_EXCLUDED_INDICES, _expand_selected_indices, _logical_index_name
from services.db import MODEL_RUNTIME_PROFILES_INDEX


def test_language_indices_share_one_logical_backup_name():
    assert _logical_index_name("doc_chunks_ko") == "doc_chunks"
    assert _logical_index_name("doc_chunks_en") == "doc_chunks"
    assert _logical_index_name("doc_chunks_all") == "doc_chunks"
    assert _logical_index_name("system_settings") == "system_settings"


def test_selecting_logical_name_expands_every_language_index():
    available = ["doc_chunks_ko", "doc_chunks_en", "doc_chunks_und", "system_settings"]

    assert _expand_selected_indices(["doc_chunks"], available) == available[:3]
    assert _expand_selected_indices(["doc_chunks_all"], available) == available[:3]
    assert _expand_selected_indices(["system_settings"], available) == ["system_settings"]


def test_machine_specific_model_profiles_are_excluded_from_backup_and_restore():
    assert MODEL_RUNTIME_PROFILES_INDEX in _BACKUP_EXCLUDED_INDICES
