import json
import pytest
from services import model_profile_defaults as defaults

GIB = 1024 ** 3


def test_metal_budget_uses_capacity_independent_of_available_memory():
    hardware = {"platform": "darwin", "metal_recommended_working_set_bytes": 18 * GIB,
                "system_memory": {"total_bytes": 24 * GIB, "available_bytes": 12 * GIB}}
    assert defaults.model_memory_budget(hardware) == 18 * GIB - int(18 * GIB * .1)
    hardware["system_memory"]["available_bytes"] = 22 * GIB
    assert defaults.model_memory_budget(hardware) == 18 * GIB - int(18 * GIB * .1)


def test_dedicated_memory_does_not_add_host_ram_to_vram():
    hardware = {"memory_mode": "dedicated", "system_memory": {"total_bytes": 64 * GIB, "available_bytes": 50 * GIB},
                "gpus": [{"backend": "CUDA", "total_bytes": 8 * GIB, "available_bytes": 0}, {"backend": "ROCm", "total_bytes": 24 * GIB, "available_bytes": 0}]}
    assert defaults.model_memory_budget(hardware) == 7 * GIB


@pytest.mark.parametrize("output_limit", [None, 512])
def test_generation_default_is_not_a_model_output_ceiling(tmp_path, monkeypatch, output_limit):
    (tmp_path / "config.json").write_text(json.dumps({"max_output_tokens": output_limit}))
    (tmp_path / "generation_config.json").write_text(json.dumps({"max_new_tokens": 2048}))
    monkeypatch.setattr(defaults, "get_downloaded_mlx_model_path", lambda _: tmp_path)
    monkeypatch.setattr(defaults, "get_installed_model_details", lambda _: {"mlx/model": {"metadata": {"contextLength": 65536}}})
    info = defaults.profile_model_info("mlx/model", "mlx")
    assert info["limits"]["output_max"] == output_limit
    assert info["generation"]["max_new_tokens"] == 2048


@pytest.fixture
def recommendation(monkeypatch, tmp_path):
    limits = {"context_min": 4096, "context_max": 131072, "output_max": 512}
    monkeypatch.setattr(defaults, "profile_model_info", lambda *_: {"path": tmp_path, "limits": limits, "generation": {}})
    monkeypatch.setattr(defaults, "get_local_hardware_info", lambda: {})
    monkeypatch.setattr(defaults, "model_memory_budget", lambda _: 8192)
    monkeypatch.setattr(defaults, "get_cached_dflash2_model", lambda _: None)


def test_context_and_cache_are_selected_together(recommendation, monkeypatch):
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda info, runtime, context, precision: context * (2 if precision == "none" else 1))
    result = defaults.hardware_model_profile("model.gguf", "gguf", None, 32768)
    assert (result["context_size"], result["kv_cache_precision"], result["mtp_enabled"], result["max_output_tokens"]) == (8192, "q8", False, 512)
    assert result["recommendation_status"] == "estimated"


@pytest.mark.parametrize("estimate,status", [(999999, "insufficient"), (0, "unavailable")])
def test_cannot_fit_preserves_practical_floor(recommendation, monkeypatch, estimate, status):
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda *_: estimate)
    result = defaults.hardware_model_profile("model.gguf", "gguf", None, 1)
    assert result["context_size"] == 4096
    assert result["recommendation_status"] == status


@pytest.mark.parametrize("runtime", ["mlx", "gguf"])
def test_mlx_and_dflash_preserve_unquantized_cache(recommendation, monkeypatch, tmp_path, runtime):
    monkeypatch.setattr(defaults, "get_mlx_memory_companions", lambda _: [])
    monkeypatch.setattr(defaults, "get_cached_dflash2_model", lambda _: tmp_path)
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda info, runtime, context, precision: context)
    result = defaults.hardware_model_profile("model", runtime, None, 32768)
    assert result["context_size"] == 8192
    assert result["kv_cache_precision"] == "none"


def test_exhausted_available_memory_does_not_change_capacity_budget():
    assert defaults.model_memory_budget({}) is None
    assert defaults.model_memory_budget({"system_memory": {"total_bytes": 24 * GIB, "available_bytes": 0}}) == 24 * GIB - int(24 * GIB * .1)


def test_exhausted_budget_keeps_floor_and_reports_insufficient(recommendation, monkeypatch):
    monkeypatch.setattr(defaults, "model_memory_budget", lambda _: 0)
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda *_: 9999)
    result = defaults.hardware_model_profile("model.gguf", "gguf", None, 32768)
    assert result["context_size"] == 4096
    assert result["recommendation_status"] == "insufficient"


@pytest.mark.parametrize("model_limit", [131072, 131073])
def test_sufficient_memory_uses_exact_metadata_maximum(monkeypatch, tmp_path, model_limit):
    info = {"path": tmp_path, "limits": {"context_min": 4096, "context_max": model_limit, "output_max": 65536},
            "generation": {"max_new_tokens": 2048, "temperature": 1.5, "top_k": 200}}
    monkeypatch.setattr(defaults, "profile_model_info", lambda *_: info)
    monkeypatch.setattr(defaults, "get_local_hardware_info", lambda: {})
    monkeypatch.setattr(defaults, "model_memory_budget", lambda _: model_limit)
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda info, runtime, context, precision: context)
    monkeypatch.setattr(defaults, "get_mlx_memory_companions", lambda _: [])
    result = defaults.hardware_model_profile("mlx/model", "mlx", None, 32768)
    assert result["context_size"] == model_limit
    assert result["max_output_tokens"] == 65536
    assert result["history_token_budget"] == model_limit - 65536 - 1024
    assert result["temperature"] == 1.5
    assert result["top_k"] == 200


@pytest.mark.parametrize("context,expected_budget", [(2048, 512), (262144, 130560)])
def test_missing_output_metadata_uses_context_budget_without_fixed_caps(monkeypatch, tmp_path, context, expected_budget):
    info = {"path": tmp_path, "limits": {"context_min": min(4096, context), "context_max": context, "output_max": None}, "generation": {}}
    monkeypatch.setattr(defaults, "profile_model_info", lambda *_: info)
    monkeypatch.setattr(defaults, "get_local_hardware_info", lambda: {})
    monkeypatch.setattr(defaults, "model_memory_budget", lambda _: 262144)
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda info, runtime, context, precision: context)
    monkeypatch.setattr(defaults, "get_mlx_memory_companions", lambda _: [])
    result = defaults.hardware_model_profile("mlx/model", "mlx", None, 32768)
    assert result["context_size"] == context
    assert result["max_output_tokens"] == result["history_token_budget"] == expected_budget


def test_memory_constrained_model_can_still_select_above_32k(recommendation, monkeypatch):
    monkeypatch.setattr(defaults, "model_memory_budget", lambda _: 98304)
    monkeypatch.setattr(defaults, "profile_memory_bytes", lambda info, runtime, context, precision: context)
    result = defaults.hardware_model_profile("model.gguf", "gguf", None, 32768)
    assert result["context_size"] == 98304
