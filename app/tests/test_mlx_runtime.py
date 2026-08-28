import asyncio
import json
import os
import signal
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.mlx_runtime import (
    MLX_MODEL_MANIFEST,
    _build_mlx_server_command,
    _build_omlx_server_command,
    _mlx_server_environment,
    associate_mlx_mtp_model,
    associate_mlx_bundled_dflash2_model,
    delete_downloaded_mlx_model,
    download_mlx_model,
    get_downloaded_mlx_model_path,
    get_omlx_install_commands,
    install_missing_omlx_runtime,
    list_downloaded_mlx_models,
    list_mtp_supported_mlx_models,
    _server_module_for_model,
    stop_mlx_runtime,
)


class MlxRuntimeTests(unittest.TestCase):
    def test_omlx_install_rejects_non_apple_silicon(self):
        async def collect_messages():
            return [message async for message in install_missing_omlx_runtime()]

        with patch("services.mlx_runtime.is_apple_silicon", return_value=False):
            with self.assertRaisesRegex(RuntimeError, "Apple Silicon"):
                asyncio.run(collect_messages())

    def test_omlx_install_trusts_formula_before_installing(self):
        commands = get_omlx_install_commands("/opt/homebrew/bin/brew")
        self.assertEqual(commands[1], [
            "/opt/homebrew/bin/brew", "trust", "--formula", "jundot/omlx/omlx",
        ])
        self.assertEqual(commands[2], ["/opt/homebrew/bin/brew", "install", "omlx"])

    def test_associates_bundled_dflash2_subdirectory(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "target"
            draft_dir = model_dir / "dflash"
            draft_dir.mkdir(parents=True)
            (draft_dir / "config.json").write_text("{}", encoding="utf-8")
            (draft_dir / "model.safetensors").touch()
            manifest_path = model_dir / MLX_MODEL_MANIFEST
            manifest_path.write_text(json.dumps({"role": "model"}), encoding="utf-8")
            associate_mlx_bundled_dflash2_model(model_dir)
            self.assertEqual(json.loads(manifest_path.read_text())["dflash2_subdirectory"], "dflash")

    def test_omlx_command_enables_dflash2_in_isolated_settings(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            models = base / "models"
            model = models / "owner" / "target"
            draft = models / "z-lab" / "target-DFlash2"
            model.mkdir(parents=True)
            draft.mkdir(parents=True)
            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", base / "omlx"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                command, environment = _build_omlx_server_command(model, draft, 32768)
            settings = json.loads((base / "omlx" / "model_settings.json").read_text(encoding="utf-8"))
            self.assertTrue(settings["models"]["target"]["dflash_enabled"])
            self.assertEqual(settings["models"]["target"]["dflash_draft_model"], str(draft))
            self.assertIn("omlx", command[0])
            self.assertEqual(environment["OMLX_BASE_PATH"], str(base / "omlx"))

    def test_mlx_server_enables_in_memory_prefix_cache(self):
        with patch.dict(os.environ, {"EXISTING_SETTING": "preserved"}, clear=True):
            environment = _mlx_server_environment()

        self.assertEqual(environment["APC_ENABLED"], "1")
        self.assertEqual(environment["APC_NUM_BLOCKS"], "2048")
        self.assertEqual(environment["APC_EXACT_CACHE_ENTRIES"], "4")
        self.assertEqual(environment["APC_DEFAULT_TENANT"], "vyact")
        self.assertEqual(environment["EXISTING_SETTING"], "preserved")

    def test_deletes_mlx_model_and_its_unreferenced_mtp_companion(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            model_dir = models_dir / "owner" / "model"
            mtp_dir = models_dir / "owner" / "model-mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/model", "mtp_repository": "owner/model-mtp",
            }))
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/model-mtp", "role": "mtp",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                delete_downloaded_mlx_model("mlx/owner/model")

            self.assertFalse(model_dir.exists())
            self.assertFalse(mtp_dir.exists())

    def test_removes_empty_mlx_owner_directory_after_model_deletion(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir) / "mlx"
            model_dir = models_dir / "owner" / "model"
            model_dir.mkdir(parents=True)
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/model"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                delete_downloaded_mlx_model("mlx/owner/model")

            self.assertFalse((models_dir / "owner").exists())
            self.assertTrue(models_dir.exists())

    def test_preserves_nonempty_mlx_owner_directory_after_model_deletion(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir) / "mlx"
            model_dir = models_dir / "owner" / "model"
            sibling_dir = models_dir / "owner" / "other-model"
            model_dir.mkdir(parents=True)
            sibling_dir.mkdir()
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/model"}))
            (sibling_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/other-model"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                delete_downloaded_mlx_model("mlx/owner/model")

            self.assertTrue((models_dir / "owner").exists())
            self.assertTrue(sibling_dir.exists())

    def test_force_stops_validated_mlx_runtime_after_graceful_timeout(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            pid_file = Path(temp_dir) / "mlx-vlm.pid"
            pid_file.write_text("1234")
            with patch("services.mlx_runtime.MLX_RUNTIME_PID_FILE", pid_file), \
                 patch("services.mlx_runtime.subprocess.check_output", return_value="python -m mlx_vlm.server"), \
                 patch("services.mlx_runtime._wait_for_process_exit", side_effect=[False, True]), \
                 patch("services.mlx_runtime.os.kill") as kill:
                stop_mlx_runtime()

            self.assertEqual(
                kill.call_args_list,
                [unittest.mock.call(1234, signal.SIGTERM), unittest.mock.call(1234, signal.SIGKILL)],
            )
            self.assertFalse(pid_file.exists())

    def test_mtp_association_adds_server_drafter_arguments(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "owner" / "model"
            mtp_dir = Path(temp_dir) / "owner" / "mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["QwenForCausalLM"]}))
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "mtp"}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"mtp_repository": "owner/mtp"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", Path(temp_dir)), \
                 patch("services.mlx_runtime._server_help", return_value="--kv-bits --quantized-kv-start"):
                command = _build_mlx_server_command(model_dir, 32768)

            self.assertIn("mlx_vlm.server", command)
            self.assertEqual(command[command.index("--draft-model") + 1], str(mtp_dir))
            self.assertEqual(command[command.index("--draft-kind") + 1], "mtp")
            self.assertNotIn("--kv-bits", command)
            self.assertNotIn("--quantized-kv-start", command)

    def test_non_mtp_model_keeps_kv_cache_quantization(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "owner" / "model"
            model_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["QwenForCausalLM"]}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/model"}))

            with patch("services.mlx_runtime._server_help", return_value="--kv-bits --quantized-kv-start"):
                command = _build_mlx_server_command(model_dir, 32768)

            self.assertEqual(command[command.index("--kv-bits") + 1], "8")
            self.assertEqual(command[command.index("--quantized-kv-start") + 1], "0")

    def test_disabling_mtp_allows_kv_cache_quantization(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "owner" / "model"
            mtp_dir = Path(temp_dir) / "owner" / "mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["QwenForCausalLM"]}))
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "mtp"}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"mtp_repository": "owner/mtp"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", Path(temp_dir)), \
                 patch("services.mlx_runtime._server_help", return_value="--kv-bits --quantized-kv-start"):
                command = _build_mlx_server_command(model_dir, 32768, cache_quantization=True, enable_mtp=False)

            self.assertNotIn("--draft-model", command)
            self.assertEqual(command[command.index("--kv-bits") + 1], "8")

    def test_mlx_q4_precision_maps_to_four_bit_cache(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "model"
            model_dir.mkdir()
            (model_dir / "config.json").write_text(json.dumps({"architectures": ["QwenForCausalLM"]}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/model"}))
            with patch("services.mlx_runtime._server_help", return_value="--kv-bits --quantized-kv-start"):
                command = _build_mlx_server_command(model_dir, 32768, kv_cache_precision="q4")
            self.assertEqual(command[command.index("--kv-bits") + 1], "4")

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

    def test_lists_mlx_models_with_mtp_companions(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            mtp_model_dir = models_dir / "owner" / "mtp-model"
            regular_model_dir = models_dir / "owner" / "regular-model"
            drafter_dir = models_dir / "owner" / "drafter"
            mtp_model_dir.mkdir(parents=True)
            regular_model_dir.mkdir(parents=True)
            drafter_dir.mkdir(parents=True)
            (mtp_model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/mtp-model", "mtp_repository": "owner/drafter",
            }))
            (regular_model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/regular-model",
            }))
            (drafter_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/drafter", "role": "mtp",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                self.assertEqual(list_mtp_supported_mlx_models(), ["mlx/owner/mtp-model"])

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
