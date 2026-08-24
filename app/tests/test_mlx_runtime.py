import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.mlx_runtime import (
    MLX_MODEL_MANIFEST,
    _build_mlx_server_command,
    associate_mlx_mtp_model,
    download_mlx_model,
    get_downloaded_mlx_model_path,
    list_downloaded_mlx_models,
    _server_module_for_model,
)


class MlxRuntimeTests(unittest.TestCase):
    def test_mtp_association_adds_server_drafter_arguments(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "owner" / "model"
            mtp_dir = Path(temp_dir) / "owner" / "mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["QwenForCausalLM"]}))
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "mtp"}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"mtp_repository": "owner/mtp"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", Path(temp_dir)):
                command = _build_mlx_server_command(model_dir, 32768)

            self.assertIn("mlx_vlm.server", command)
            self.assertEqual(command[command.index("--draft-model") + 1], str(mtp_dir))
            self.assertEqual(command[command.index("--draft-kind") + 1], "mtp")

    def test_associates_mtp_without_listing_drafter_as_selectable_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            model_dir = models_dir / "owner" / "model"
            mtp_dir = models_dir / "owner" / "model-mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/model"}))
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/model-mtp", "role": "mtp",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                associate_mlx_mtp_model(model_dir, "owner/model-mtp", mtp_dir)
                self.assertEqual(list_downloaded_mlx_models(), ["mlx/owner/model"])
            manifest = json.loads((model_dir / MLX_MODEL_MANIFEST).read_text())
            self.assertEqual(manifest["mtp_repository"], "owner/model-mtp")

    def test_explicit_download_temporarily_disables_hub_offline_mode(self):
        import huggingface_hub.constants as hub_constants

        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)

            def fake_snapshot_download(**kwargs):
                self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "0")
                self.assertFalse(hub_constants.HF_HUB_OFFLINE)
                destination = Path(kwargs["local_dir"])
                (destination / "config.json").write_text("{}")
                (destination / "model.safetensors").write_bytes(b"weights")

            with patch.dict(os.environ, {"HF_HUB_OFFLINE": "1"}), \
                 patch.object(hub_constants, "HF_HUB_OFFLINE", True), \
                 patch("services.mlx_runtime.is_apple_silicon", return_value=True), \
                 patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir), \
                 patch("huggingface_hub.snapshot_download", side_effect=fake_snapshot_download):
                model_path = download_mlx_model("owner/model", "revision")
                self.assertEqual(os.environ.get("HF_HUB_OFFLINE"), "1")
                self.assertTrue(hub_constants.HF_HUB_OFFLINE)

            self.assertEqual(model_path, models_dir / "owner" / "model")

    def test_lists_and_resolves_downloaded_repository(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            model_dir = models_dir / "mlx-community" / "model-4bit"
            model_dir.mkdir(parents=True)
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "mlx-community/model-4bit"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                self.assertEqual(list_downloaded_mlx_models(), ["mlx/mlx-community/model-4bit"])
                self.assertEqual(
                    get_downloaded_mlx_model_path("mlx/mlx-community/model-4bit"), model_dir.resolve(),
                )

    def test_rejects_repository_path_traversal(self):
        with tempfile.TemporaryDirectory() as temp_dir, \
             patch("services.mlx_runtime.MLX_MODELS_DIR", Path(temp_dir)):
            with self.assertRaises(ValueError):
                get_downloaded_mlx_model_path("mlx/../model")

    def test_selects_vlm_server_for_vision_config(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir)
            (model_dir / "config.json").write_text(json.dumps({"vision_config": {"image_size": 384}}))
            self.assertEqual(_server_module_for_model(model_dir), "mlx_vlm.server")

    def test_selects_lm_server_for_text_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir)
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["LlamaForCausalLM"]}))
            self.assertEqual(_server_module_for_model(model_dir), "mlx_lm.server")
