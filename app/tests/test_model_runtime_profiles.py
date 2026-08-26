from services.model_runtime_profiles import build_model_profile_id, recommended_model_profile


def test_profile_ids_are_stable_and_model_specific():
    assert build_model_profile_id("owner/model.gguf") == build_model_profile_id("owner/model.gguf")
    assert build_model_profile_id("owner/model.gguf") != build_model_profile_id("owner/other.gguf")


def test_recommended_profile_bounds_context_and_uses_conservative_output_limit():
    profile = recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 262144)

    assert profile["context_size"] == 131072
    assert profile["max_output_tokens"] == 2048
    assert profile["cache_quantization"] is True
