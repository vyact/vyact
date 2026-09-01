import asyncio
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from services.huggingface_models import (
    MLX_REPOSITORY_FILE,
    _is_standalone_or_embedded_mtp_repository,
    _mlx_model_from_hub_item,
    _is_bundled_dflash2_mlx,
    _mlx_quantization_label,
    _mlx_quantization_label_from_repository,
    _mlx_mtp_search_query,
    _mlx_specprefill_search_query,
    _merge_search_and_detail,
    calculate_mlx_metadata_from_config,
    _model_file_size_from_hub_item,
    _model_from_hub_item,
    _safe_relative_file_path,
    _mlx_target_search_query,
    _select_mlx_mtp_model,
    _select_mlx_specprefill_model,
    _select_dflash2_model,
    _select_mtp_sidecar,
    _select_vision_projector,
    download_gguf_model,
    search_mlx_models,
)
from services.omlx_policy import is_external_mtp_compatible
from services import omlx_policy


class HuggingFaceModelTests(unittest.TestCase):
    def test_reads_new_external_mtp_types_from_installed_omlx(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            executable = Path(temp_dir) / "omlx"
            executable.write_text("#!/runtime/python\n")
            discovered = '["deepseek_v4_mtp", "gemma4_assistant", "gemma4_unified_assistant", "qwen3_5_mtp"]\n'
            with patch("services.omlx_policy.shutil.which", return_value=str(executable)), \
                 patch("services.omlx_policy._omlx_python_executable", return_value="/runtime/python"), \
                 patch("services.omlx_policy.subprocess.run", return_value=SimpleNamespace(stdout=discovered)), \
                 patch.object(omlx_policy, "_omlx_capability_signature", None), \
                 patch.object(
                     omlx_policy, "_external_mtp_target_draft_types",
                     omlx_policy._DEFAULT_EXTERNAL_MTP_TARGET_DRAFT_TYPES,
                 ):
                capabilities = omlx_policy.refresh_external_mtp_capabilities(force=True)
                self.assertIn((("deepseek_v4",), "deepseek_v4_mtp"), capabilities)
                self.assertEqual(
                    omlx_policy.external_mtp_draft_type({"model_type": "deepseek_v4"}),
                    "deepseek_v4_mtp",
                )
                self.assertEqual(
                    omlx_policy.external_mtp_draft_type({"model_type": "gemma4_unified"}),
                    "gemma4_unified_assistant",
                )
                self.assertTrue(omlx_policy.is_external_mtp_compatible(
                    {"model_type": "deepseek_v4", "hidden_size": 7168},
                    {"model_type": "deepseek_v4_mtp", "backbone_hidden_size": 7168},
                ))

    def test_normalizes_mtp_search_to_the_target_model_query(self):
        self.assertEqual(
            _mlx_target_search_query("qwen3.5 9b 8bit external MTP"),
            "qwen3.5 9b 8bit",
        )

    def test_normalizes_exact_target_name_to_mtp_family_query(self):
        self.assertEqual(_mlx_mtp_search_query("Qwen3.5-9B-MLX-8bit"), "Qwen3.5 9B")
        self.assertEqual(_mlx_mtp_search_query("Qwen3.5 9b 8bit external MTP"), "Qwen3.5 9b")

    def test_normalizes_target_name_to_specprefill_family_query(self):
        self.assertEqual(_mlx_specprefill_search_query("Qwen3.5-9B-MLX-8bit"), "Qwen3.5")

    def test_external_mtp_compatibility_uses_supported_types_and_dimensions(self):
        qwen_target = {
            "model_type": "qwen3_5_moe",
            "text_config": {"hidden_size": 4096, "vocab_size": 248320},
        }
        self.assertTrue(is_external_mtp_compatible(qwen_target, {
            "model_type": "qwen3_5_mtp", "hidden_size": 4096, "vocab_size": 248320,
        }))
        self.assertFalse(is_external_mtp_compatible(qwen_target, {
            "model_type": "qwen3_5_mtp", "hidden_size": 2048, "vocab_size": 248320,
        }))
        self.assertFalse(is_external_mtp_compatible(qwen_target, {
            "model_type": "unsupported_mtp", "hidden_size": 4096, "vocab_size": 248320,
        }))
        self.assertTrue(is_external_mtp_compatible(
            {"model_type": "gemma4_text", "hidden_size": 2560},
            {"model_type": "gemma4_assistant", "hidden_size": 2560},
        ))
        self.assertFalse(is_external_mtp_compatible(
            {"model_type": "gemma4_text"}, {"model_type": "gemma4_assistant"},
        ))

    def test_excludes_full_mtp_and_mtplx_repositories_from_target_results(self):
        self.assertTrue(_is_standalone_or_embedded_mtp_repository(
            "owner/Qwen3.5-9B-mlx-8bit-mtp", {"model_type": "qwen3_5"},
        ))
        self.assertTrue(_is_standalone_or_embedded_mtp_repository(
            "owner/Qwen3.5-9B-MTPLX-8bit", {"model_type": "qwen3_5"},
        ))
        self.assertTrue(_is_standalone_or_embedded_mtp_repository(
            "owner/Qwen3.5-9B-MTP-4bit", {"model_type": "qwen3_5_mtp"},
        ))
        self.assertFalse(_is_standalone_or_embedded_mtp_repository(
            "mlx-community/Qwen3.5-9B-MLX-8bit", {"model_type": "qwen3_5"},
        ))

    def test_search_attaches_external_mtp_to_compatible_target(self):
        target_item = {
            "id": "mlx-community/Qwen3.5-9B-MLX-8bit", "sha": "target", "downloads": 100,
            "siblings": [{"rfilename": "config.json"}, {"rfilename": "model.safetensors", "size": 10}],
        }
        embedded_item = {
            "id": "owner/Qwen3.5-9B-MTPLX-8bit", "sha": "embedded", "downloads": 10,
            "siblings": [{"rfilename": "config.json"}, {"rfilename": "model.safetensors", "size": 10}],
        }
        target_config = {"model_type": "qwen3_5", "hidden_size": 4096}
        candidate = {
            "repository": "mlx-community/Qwen3.5-9B-MTP-bf16", "revision": "draft",
            "size": 38_000_000,
            "config": {"model_type": "qwen3_5_mtp", "hidden_size": 4096},
        }

        class FakeResponse:
            def raise_for_status(self):
                return None

            def json(self):
                return [target_item, embedded_item]

        class FakeClient:
            async def __aenter__(self):
                return self

            async def __aexit__(self, *args):
                return None

            async def get(self, _url, params=None, headers=None):
                self.params = params
                return FakeResponse()

        async def fake_configs(_client, _items, _token):
            return {target_item["id"]: target_config, embedded_item["id"]: target_config}

        async def fake_candidates(_query, _token):
            return [candidate]

        fake_client = FakeClient()
        with patch("services.huggingface_models.httpx.AsyncClient", return_value=fake_client), \
             patch("services.huggingface_models._fetch_mlx_configs", side_effect=fake_configs), \
             patch("services.huggingface_models._search_mlx_mtp_models", side_effect=fake_candidates), \
             patch("services.huggingface_models._search_mlx_specprefill_models", return_value=[]):
            models = asyncio.run(search_mlx_models("qwen3.5 9b 8bit mtp"))

        self.assertEqual(fake_client.params["search"], "qwen3.5 9b 8bit")
        self.assertEqual(fake_client.params["limit"], 10)
        self.assertEqual([model["id"] for model in models], [target_item["id"]])
        self.assertEqual(models[0]["mtp_model"]["repository"], candidate["repository"])
        self.assertEqual(models[0]["mtp_supported_files"], [MLX_REPOSITORY_FILE])

    def test_selects_small_compatible_specprefill_model(self):
        target_config = {"model_type": "qwen3_5", "text_config": {"vocab_size": 248320}}
        selected = _select_mlx_specprefill_model(
            "owner/Qwen3.5-9B-MLX-8bit",
            [
                {"repository": "owner/Qwen3.5-4B-MLX-4bit", "revision": "large", "size": 4_000,
                 "config": target_config},
                {"repository": "owner/Qwen3.5-0.8B-MLX-4bit", "revision": "small", "size": 800,
                 "config": target_config},
                {"repository": "owner/Other-0.5B-MLX-4bit", "revision": "wrong", "size": 500,
                 "config": {"model_type": "other", "vocab_size": 248320}},
            ],
            target_config,
            9_000,
        )
        self.assertEqual(selected["revision"], "small")

    def test_reads_selected_gguf_size_from_repository_details(self):
        item = {"siblings": [
            {"rfilename": "model-Q4.gguf", "lfs": {"size": 4_000}},
            {"rfilename": "model-Q8.gguf", "size": 8_000},
        ]}
        self.assertEqual(_model_file_size_from_hub_item(item, "model-Q4.gguf", "gguf"), 4_000)

    def test_sums_only_mlx_download_files_from_repository_details(self):
        item = {"siblings": [
            {"rfilename": "config.json", "size": 200},
            {"rfilename": "model.safetensors", "size": 3_000},
            {"rfilename": "README.md", "size": 9_000},
        ]}
        self.assertEqual(_model_file_size_from_hub_item(item, "__mlx_repository__", "mlx"), 3_200)

    def test_detects_complete_bundled_dflash2_mlx_repository(self):
        item = {
            "id": "owner/Qwen3.8-27B-DFlash2-MLX",
            "siblings": [
                {"rfilename": "config.json"},
                {"rfilename": "model-00001-of-00002.safetensors", "size": 100},
                {"rfilename": "dflash/config.json"},
                {"rfilename": "dflash/model.safetensors", "size": 10},
            ],
        }
        self.assertTrue(_is_bundled_dflash2_mlx(item))
        model = _mlx_model_from_hub_item(item, {})
        self.assertTrue(model["dflash2_bundled"])
        self.assertEqual(model["dflash2_supported_files"], ["__mlx_repository__"])

    def test_does_not_treat_drafter_only_repository_as_bundle(self):
        self.assertFalse(_is_bundled_dflash2_mlx({"siblings": [
            {"rfilename": "config.json"}, {"rfilename": "model.safetensors"},
        ]}))

    def test_selects_matching_dflash2_model_across_gguf_and_mlx_names(self):
        candidates = [
            {"repository": "z-lab/Qwen3.8-27B-DFlash2-GGUF", "revision": "draft", "size": 100},
            {"repository": "z-lab/Qwen3.8-4B-DFlash2-GGUF", "revision": "wrong", "size": 10},
        ]
        self.assertEqual(_select_dflash2_model("owner/Qwen3.8-27B-GGUF", candidates)["revision"], "draft")
        self.assertEqual(_select_dflash2_model("owner/Qwen3.8-27B-MLX-4bit", candidates)["revision"], "draft")

    def test_selects_matching_bf16_mlx_mtp_drafter(self):
        selected = _select_mlx_mtp_model("lmstudio-community/Qwen3.8-27B-MLX-4bit", [
            {"repository": "mlx-community/Qwen3.8-27B-MTP-4bit", "revision": "bad", "size": 100},
            {"repository": "mlx-community/Qwen3.8-27B-MTP-bf16", "revision": "good", "size": 200},
            {"repository": "mlx-community/Qwen3.8-4B-MTP-bf16", "revision": "other", "size": 50},
        ])

        self.assertEqual(selected["revision"], "good")

    def test_estimates_mlx_metadata_from_text_config_without_weights(self):
        metadata = calculate_mlx_metadata_from_config({
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
        self.assertEqual(
            metadata["kv_cache_bytes"],
            32768 * 32 * 8 * 128 * 2 * 1.0625
        )
        self.assertGreater(metadata["estimated_memory_bytes"], 10_000_000_000)

    def test_estimates_hybrid_mlx_kv_cache_per_attention_type(self):
        metadata = calculate_mlx_metadata_from_config({
            "architectures": ["Gemma4ForConditionalGeneration"],
            "text_config": {
                "num_hidden_layers": 48,
                "num_attention_heads": 16,
                "num_key_value_heads": 8,
                "num_global_key_value_heads": 1,
                "head_dim": 256,
                "global_head_dim": 512,
                "max_position_embeddings": 262144,
                "sliding_window": 1024,
                "layer_types": [
                    layer_type
                    for _ in range(8)
                    for layer_type in (["sliding_attention"] * 5 + ["full_attention"])
                ],
            },
        }, file_size=6_300_000_000, context_size=32768)

        sliding_cache_bytes = 40 * 1024 * 8 * 256 * 2 * 1.0625
        full_cache_bytes = 8 * 32768 * 1 * 512 * 2 * 1.0625

        self.assertEqual(
            metadata["kv_cache_bytes"],
            sliding_cache_bytes + full_cache_bytes
        )

    def test_accepts_repository_relative_gguf_path(self):
        self.assertEqual(str(_safe_relative_file_path("Q4/model.gguf")), "Q4/model.gguf")

    def test_rejects_path_traversal_and_non_gguf_files(self):
        for filename in ("../model.gguf", "/model.gguf", "model.bin"):
            with self.assertRaises(ValueError):
                _safe_relative_file_path(filename)

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
            "dflash2_supported_files": [],
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
        }, {"quantization": {"group_size": 64, "bits": 4, "mode": "affine"}})

        self.assertEqual(model["runtime"], "mlx")
        self.assertEqual(model["files"], ["__mlx_repository__"])
        self.assertEqual(model["file_sizes"], {"__mlx_repository__": 3_200})
        self.assertEqual(model["quantization"], "4-bit")

    def test_reads_mlx_quantization_from_nested_text_config(self):
        label = _mlx_quantization_label({
            "text_config": {"quantization_config": {"weight_bits": 8}},
        })

        self.assertEqual(label, "8-bit")

    def test_reads_mlx_dtype_when_weights_are_not_quantized(self):
        self.assertEqual(_mlx_quantization_label({"dtype": "bfloat16"}), "BF16")

    def test_reads_mlx_quantization_from_repository_without_config_request(self):
        self.assertEqual(_mlx_quantization_label_from_repository("owner/model-4bit"), "4-bit")
        self.assertEqual(_mlx_quantization_label_from_repository("owner/model-BF16"), "BF16")

    def test_prefers_mlx_quantization_algorithm_over_storage_dtype(self):
        label = _mlx_quantization_label({
            "dtype": "bfloat16",
            "quantization_config": {
                "quant_method": "modelopt",
                "quantization": {"quant_algo": "NVFP4"},
            },
        })

        self.assertEqual(label, "NVFP4")

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
