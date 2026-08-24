import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.mlx_runtime import (
    MLX_MODEL_MANIFEST,
    get_downloaded_mlx_model_path,
    list_downloaded_mlx_models,
    _server_module_for_model,
)


class MlxRuntimeTests(unittest.TestCase):
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
