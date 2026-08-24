import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.huggingface_models import (
    RECOMMENDED_GGUF_REPOSITORIES,
    _mlx_model_from_hub_item,
    _merge_search_and_detail,
    _mlx_metadata_from_config,
    _model_from_hub_item,
    _safe_relative_file_path,
    _select_mlx_mtp_model,
    _select_mtp_sidecar,
    _select_vision_projector,
    download_gguf_model,
)


class HuggingFaceModelTests(unittest.TestCase):
    def test_selects_matching_bf16_mlx_mtp_drafter(self):
        selected = _select_mlx_mtp_model("lmstudio-community/Qwen3.8-27B-MLX-4bit", [
            {"repository": "mlx-community/Qwen3.8-27B-MTP-4bit", "revision": "bad", "size": 100},
            {"repository": "mlx-community/Qwen3.8-27B-MTP-bf16", "revision": "good", "size": 200},
            {"repository": "mlx-community/Qwen3.8-4B-MTP-bf16", "revision": "other", "size": 50},
        ])

        self.assertEqual(selected["revision"], "good")

    def test_estimates_mlx_metadata_from_text_config_without_weights(self):
        metadata = _mlx_metadata_from_config({
            "architectures": ["QwenForCausalLM"],
            "text_config": {
                "num_hidden_layers": 32,
                "num_attention_heads": 32,
                "num_key_value_heads": 8,
                "hidden_size": 4096,
                "max_position_embeddings": 65536,
            },
        }, file_size=10_000_000_000, context_size=32768)

        self.assertEqual(metadata["architecture"], "QwenForCausalLM")
        self.assertEqual(metadata["block_count"], 32)
        self.assertEqual(metadata["context_length"], 65536)
        self.assertEqual(metadata["kv_cache_bytes"], 32768 * 32 * 8 * 128 * 2 * 2)
        self.assertGreater(metadata["estimated_memory_bytes"], 10_000_000_000)

    def test_accepts_repository_relative_gguf_path(self):
        self.assertEqual(str(_safe_relative_file_path("Q4/model.gguf")), "Q4/model.gguf")

    def test_rejects_path_traversal_and_non_gguf_files(self):
        for filename in ("../model.gguf", "/model.gguf", "model.bin"):
            with self.assertRaises(ValueError):
                _safe_relative_file_path(filename)

    def test_recommended_models_cover_small_medium_and_large_choices(self):
        self.assertEqual(len(RECOMMENDED_GGUF_REPOSITORIES), 3)
        self.assertTrue(any("4B" in repo_id for repo_id in RECOMMENDED_GGUF_REPOSITORIES))
        self.assertTrue(any("9B" in repo_id for repo_id in RECOMMENDED_GGUF_REPOSITORIES))

    def test_hub_item_keeps_only_gguf_files(self):
        model = _model_from_hub_item({
            "id": "owner/model-GGUF",
            "sha": "abc123",
            "downloads": 12,
            "siblings": [{"rfilename": "model.gguf", "size": 1024}, {"rfilename": "README.md"}],
        })
        self.assertEqual(model, {
            "id": "owner/model-GGUF", "runtime": "gguf", "revision": "abc123", "downloads": 12,
            "files": ["model.gguf"], "file_sizes": {"model.gguf": 1024},
            "mtp_supported_files": [],
        })

    def test_search_item_uses_detailed_file_sizes_without_losing_search_downloads(self):
        merged = _merge_search_and_detail(
            {"id": "owner/model-GGUF", "downloads": 42, "siblings": [{"rfilename": "model.gguf"}]},
            {
                "id": "owner/model-GGUF",
                "downloads": 1,
                "siblings": [{"rfilename": "model.gguf", "size": 5_000}],
            },
        )

        model = _model_from_hub_item(merged)

        self.assertEqual(model["downloads"], 42)
        self.assertEqual(model["file_sizes"], {"model.gguf": 5_000})

    def test_mlx_hub_item_represents_the_complete_repository(self):
        model = _mlx_model_from_hub_item({
            "id": "mlx-community/model-4bit",
            "sha": "def456",
            "downloads": 20,
            "siblings": [
                {"rfilename": "config.json", "size": 200},
                {"rfilename": "model-00001-of-00002.safetensors", "size": 1_000},
                {"rfilename": "model-00002-of-00002.safetensors", "lfs": {"size": 2_000}},
                {"rfilename": "README.md", "size": 5_000},
            ],
        })

        self.assertEqual(model["runtime"], "mlx")
        self.assertEqual(model["files"], ["__mlx_repository__"])
        self.assertEqual(model["file_sizes"], {"__mlx_repository__": 3_200})

    def test_hub_item_marks_files_with_a_matching_mtp_sidecar(self):
        model = _model_from_hub_item({
            "id": "owner/Qwen-GGUF",
            "siblings": [
                {"rfilename": "Qwen-Q4_K_M.gguf", "size": 1000},
                {"rfilename": "MTP/mtp-Qwen-Q4_0.gguf", "size": 100},
            ],
        })
        self.assertEqual(model["mtp_supported_files"], ["Qwen-Q4_K_M.gguf"])

    def test_selects_small_mtp_sidecar_without_treating_full_model_as_sidecar(self):
        selected = _select_mtp_sidecar({"siblings": [
            {"rfilename": "Qwen-MTP-Q4_K_M.gguf", "size": 5_000},
            {"rfilename": "MTP/mtp-Qwen-Q8_0.gguf", "size": 2_000},
            {"rfilename": "MTP/mtp-Qwen-Q4_0.gguf", "size": 1_000},
            {"rfilename": "MTP/mtp-Other-Q4_0.gguf", "size": 500},
        ]}, "Qwen-Q4_K_M.gguf")
        self.assertEqual(selected, ("MTP/mtp-Qwen-Q4_0.gguf", 1_000))

    def test_selects_f16_vision_projector(self):
        selected = _select_vision_projector({"siblings": [
            {"rfilename": "model-Q4_K_M.gguf", "size": 5_000},
            {"rfilename": "mmproj-BF16.gguf", "size": 2_000},
            {"rfilename": "vision/mmproj-F16.gguf", "size": 2_100},
        ]}, "model-Q4_K_M.gguf")

        self.assertEqual(selected, ("vision/mmproj-F16.gguf", 2_100))


class HuggingFaceModelDownloadTests(unittest.IsolatedAsyncioTestCase):
    async def test_existing_complete_model_is_not_downloaded_again(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            model_path = models_dir / "owner" / "model" / "model.gguf"
            model_path.parent.mkdir(parents=True)
            model_path.write_bytes(b"existing-model")
            with patch("services.huggingface_models.VYACT_MODELS_DIR", models_dir), \
                 patch("services.huggingface_models.cache_downloaded_model") as cache_model:
                progress = [item async for item in download_gguf_model("owner/model", "model.gguf")]

            self.assertEqual(progress, [(14, 14)])
            cache_model.assert_called_once_with("owner/model/model.gguf")
