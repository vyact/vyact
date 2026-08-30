import json
import os

from services.huggingface_models import recommend_downloaded_mlx_context
from services.model_runtime_profiles import recommended_model_profile


def test_recommends_64k_for_qwen_9b_mlx_on_24gb(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({
        "text_config": {
            "max_position_embeddings": 262144,
            "hidden_size": 4096,
            "num_hidden_layers": 32,
            "num_attention_heads": 16,
            "num_key_value_heads": 4,
            "head_dim": 256,
        },
    }), encoding="utf-8")
    (tmp_path / "model.safetensors").write_bytes(b"x" * 1024)

    # Use the real model's approximate weight size without allocating a 5.6 GiB fixture.
    model_file = tmp_path / "model.safetensors"
    os.truncate(model_file, 5_977_082_381)

    context = recommend_downloaded_mlx_context(tmp_path, 24 * 1024 ** 3)

    assert context == 65536


def test_large_context_recommendation_scales_history_and_output_defaults():
    profile = recommended_model_profile("mlx/owner/model", "mlx", "owner/model", 65536)

    assert profile["context_size"] == 65536
    assert profile["history_token_budget"] == 32768
    assert profile["max_output_tokens"] == 4096
