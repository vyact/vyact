from routers.backup import (
    _BACKUP_EXCLUDED_INDICES,
    _expand_selected_indices,
    _logical_index_name,
    _preserve_machine_local_config,
)
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


def test_restore_preserves_current_provider_and_local_model_selection():
    backup = {"indices": {"system_settings": {"docs": [{
        "_id": "config",
        "_source": {"value": {
            "type": "vyact",
            "model": "stale-model",
            "vyact_config": {"model_path": "mlx/owner/stale", "runtime": "mlx"},
            "runtime_settings": {"document_chunk_size": 900},
        }},
    }]}}}
    current = {
        "type": "openai",
        "model": "current-model",
        "vyact_config": {"model_path": "mlx/owner/current", "runtime": "mlx"},
    }

    _preserve_machine_local_config(backup, current)

    restored = backup["indices"]["system_settings"]["docs"][0]["_source"]["value"]
    assert restored["type"] == "openai"
    assert restored["model"] == "current-model"
    assert restored["vyact_config"] == current["vyact_config"]
    assert restored["runtime_settings"] == {"document_chunk_size": 900}


def test_restore_drops_backup_model_selection_when_current_config_has_no_field():
    backup = {"indices": {"system_settings": {"docs": [{
        "_id": "config",
        "_source": {"value": {
            "type": "vyact",
            "model": "stale-model",
            "vyact_config": {"model_path": "mlx/owner/stale"},
        }},
    }]}}}

    _preserve_machine_local_config(backup, {})

    restored = backup["indices"]["system_settings"]["docs"][0]["_source"]["value"]
    assert "type" not in restored
    assert "model" not in restored
    assert "vyact_config" not in restored
