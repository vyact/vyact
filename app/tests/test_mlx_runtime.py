import asyncio
import json
import os
import signal
import struct
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, Mock, patch

from services.mlx_runtime import (
    MLX_MODEL_MANIFEST,
    _build_omlx_server_command,
    associate_mlx_mtp_model,
    associate_mlx_bundled_dflash2_model,
    delete_downloaded_mlx_model,
    download_mlx_model,
    get_downloaded_mlx_model_path,
    get_mlx_downloaded_bytes,
    get_omlx_install_commands,
    install_missing_omlx_runtime,
    list_downloaded_mlx_models,
    list_mtp_supported_mlx_models,
    prepare_mlx_specprefill_draft,
    start_mlx_model,
    stop_mlx_runtime,
)


class MlxRuntimeTests(unittest.TestCase):
    @staticmethod
    def _write_safetensors_metadata(
        path: Path, metadata: dict[str, str], tensors: dict | None = None,
    ):
        header = json.dumps({"__metadata__": metadata, **(tensors or {})}).encode("utf-8")
        path.write_bytes(struct.pack("<Q", len(header)) + header)

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
            (model / MLX_MODEL_MANIFEST).write_text(json.dumps({"dflash2_repository": "z-lab/target-DFlash2"}))
            (draft / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "dflash2"}))
            (draft / "config.json").write_text(
                json.dumps({"architectures": ["DFlash2DraftModel"]}), encoding="utf-8",
            )
            self._write_safetensors_metadata(
                draft / "model.safetensors", {"bits": "4", "group_size": "64"}, {
                    "projection.scales": {"shape": [16, 2], "dtype": "BF16", "data_offsets": [0, 0]},
                    "projection.weight": {"shape": [16, 16], "dtype": "U32", "data_offsets": [0, 0]},
                    "codebook.scales": {"shape": [16, 2], "dtype": "BF16", "data_offsets": [0, 0]},
                    "codebook.weight": {"shape": [16, 32], "dtype": "U32", "data_offsets": [0, 0]},
                },
            )
            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", base / "omlx"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                command, environment, mode = _build_omlx_server_command(model, 32768)
            settings = json.loads((base / "omlx" / "model_settings.json").read_text(encoding="utf-8"))
            self.assertTrue(settings["models"]["target"]["dflash_enabled"])
            overlay = base / "omlx" / "dflash-drafts" / "target"
            self.assertEqual(settings["models"]["target"]["dflash_draft_model"], str(overlay))
            self.assertNotIn("dflash_draft_quant_enabled", settings["models"]["target"])
            overlay_config = json.loads((overlay / "config.json").read_text(encoding="utf-8"))
            self.assertEqual(overlay_config["quantization"]["bits"], 4)
            self.assertEqual(overlay_config["quantization"]["codebook"]["bits"], 8)
            self.assertEqual((overlay / "model.safetensors").resolve(), (draft / "model.safetensors").resolve())
            self.assertIn("omlx", command[0])
            self.assertEqual(environment["OMLX_BASE_PATH"], str(base / "omlx"))
            self.assertEqual(mode, "dflash2")
            self.assertIn("--paged-ssd-cache-dir", command)
            self.assertIn("--hot-cache-write-through", command)

    def test_omlx_command_leaves_unquantized_dflash2_draft_unchanged(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "models" / "owner" / "target"
            draft = base / "models" / "owner" / "draft"
            model.mkdir(parents=True)
            draft.mkdir(parents=True)
            (model / MLX_MODEL_MANIFEST).write_text(json.dumps({"dflash2_repository": "owner/draft"}))
            (draft / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "dflash2"}))
            (draft / "config.json").write_text("{}")
            (draft / "model.safetensors").touch()
            with patch("services.mlx_runtime.MLX_MODELS_DIR", base / "models"), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", base / "omlx"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                _build_omlx_server_command(model, 32768)
            settings = json.loads((base / "omlx" / "model_settings.json").read_text(encoding="utf-8"))
            self.assertNotIn("dflash_draft_quant_enabled", settings["models"]["target"])

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

    def test_deleting_target_preserves_shared_specprefill_draft_and_role(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            first_target = models_dir / "owner" / "first"
            second_target = models_dir / "owner" / "second"
            draft = models_dir / "owner" / "draft"
            for path in (first_target, second_target, draft):
                path.mkdir(parents=True)
            for target, repository in ((first_target, "owner/first"), (second_target, "owner/second")):
                (target / MLX_MODEL_MANIFEST).write_text(json.dumps({
                    "repository": repository, "specprefill_repository": "owner/draft",
                }))
            draft_manifest = draft / MLX_MODEL_MANIFEST
            draft_manifest.write_text(json.dumps({
                "repository": "owner/draft", "role": "specprefill",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                delete_downloaded_mlx_model("mlx/owner/first")

            self.assertTrue(draft.is_dir())
            self.assertEqual(json.loads(draft_manifest.read_text())["role"], "specprefill")
            self.assertEqual(
                json.loads((second_target / MLX_MODEL_MANIFEST).read_text())["specprefill_repository"],
                "owner/draft",
            )

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
            pid_file = Path(temp_dir) / "omlx.pid"
            pid_file.write_text("1234")
            with patch("services.mlx_runtime.MLX_RUNTIME_PID_FILE", pid_file), \
                 patch("services.mlx_runtime.subprocess.check_output", return_value="omlx serve"), \
                 patch("services.mlx_runtime._wait_for_process_exit", side_effect=[False, True]), \
                 patch("services.mlx_runtime.os.kill") as kill:
                stop_mlx_runtime()

            self.assertEqual(
                kill.call_args_list,
                [unittest.mock.call(1234, signal.SIGTERM), unittest.mock.call(1234, signal.SIGKILL)],
            )
            self.assertFalse(pid_file.exists())

    def test_mtp_association_configures_external_vlm_mtp_only(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            model_dir = Path(temp_dir) / "owner" / "model"
            mtp_dir = Path(temp_dir) / "owner" / "mtp"
            model_dir.mkdir(parents=True)
            mtp_dir.mkdir(parents=True)
            (model_dir / "config.json").write_text(json.dumps({
                "model_type": "qwen3_5", "hidden_size": 4096, "vocab_size": 248320,
            }))
            (mtp_dir / "config.json").write_text(json.dumps({
                "model_type": "qwen3_5_mtp", "hidden_size": 4096, "vocab_size": 248320,
            }))
            (mtp_dir / "model.safetensors").touch()
            (mtp_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "mtp"}))
            (model_dir / MLX_MODEL_MANIFEST).write_text(json.dumps({"mtp_repository": "owner/mtp"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", Path(temp_dir)), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", Path(temp_dir) / "omlx"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                _, _, mode = _build_omlx_server_command(model_dir, 32768)
                settings = json.loads((Path(temp_dir) / "omlx" / "model_settings.json").read_text())

            model_settings = settings["models"]["model"]
            self.assertEqual(mode, "external_mtp")
            self.assertTrue(model_settings["vlm_mtp_enabled"])
            self.assertFalse(model_settings["specprefill_enabled"])
            self.assertFalse(model_settings["mtp_enabled"])

    def test_omlx_ignores_existing_specprefill_draft(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            models = base / "models"
            model = models / "owner" / "target"
            draft = models / "owner" / "draft"
            model.mkdir(parents=True)
            draft.mkdir(parents=True)
            shared_tokenizer = {"tokenizer_class": "Qwen2Tokenizer"}
            for path in (model, draft):
                (path / "config.json").write_text(json.dumps({
                    "model_type": "qwen3_5", "vocab_size": 151936,
                }))
                (path / "tokenizer_config.json").write_text(json.dumps(shared_tokenizer))
                (path / "tokenizer.json").write_text(json.dumps({"model": {"vocab": {"hello": 0}}}))
            (model / "model.safetensors").write_bytes(b"target-weights")
            (draft / "model.safetensors").write_bytes(b"draf")
            (model / MLX_MODEL_MANIFEST).write_text(json.dumps({"specprefill_repository": "owner/draft"}))
            (draft / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "specprefill"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", base / "omlx"), \
                 patch("services.mlx_runtime._OMLX_CACHE_DIR", base / "cache"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                _, _, mode = _build_omlx_server_command(model, 32768)

            settings = json.loads((base / "omlx" / "model_settings.json").read_text())["models"]["target"]
            self.assertEqual(mode, "none")
            self.assertFalse(settings["specprefill_enabled"])
            self.assertNotIn("specprefill_draft_model", settings)
            self.assertFalse(settings["mtp_enabled"])

    def test_specprefill_rejects_different_token_id_mapping(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            models = base / "models"
            model = models / "owner" / "target"
            draft = models / "owner" / "draft"
            for path, token_id in ((model, 0), (draft, 1)):
                path.mkdir(parents=True)
                (path / "config.json").write_text(json.dumps({
                    "model_type": "qwen3_5", "vocab_size": 151936,
                }))
                (path / "tokenizer_config.json").write_text(json.dumps({"tokenizer_class": "Qwen2Tokenizer"}))
                (path / "tokenizer.json").write_text(json.dumps({"model": {"vocab": {"hello": token_id}}}))
            (model / "model.safetensors").write_bytes(b"target-weights")
            (draft / "model.safetensors").write_bytes(b"draf")
            (model / MLX_MODEL_MANIFEST).write_text(json.dumps({"specprefill_repository": "owner/draft"}))
            (draft / MLX_MODEL_MANIFEST).write_text(json.dumps({"role": "specprefill"}))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", base / "omlx"), \
                 patch("services.mlx_runtime._OMLX_CACHE_DIR", base / "cache"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"):
                _, _, mode = _build_omlx_server_command(model, 32768)

            self.assertEqual(mode, "none")

    def test_prepared_specprefill_draft_is_not_loaded_by_omlx(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models = Path(temp_dir) / "models"
            target = models / "owner" / "target"
            draft = models / "draft-owner" / "draft"
            target.mkdir(parents=True)
            draft.mkdir(parents=True)
            shared_tokenizer = {"tokenizer_class": "Qwen2Tokenizer"}
            for path in (target, draft):
                (path / "config.json").write_text(json.dumps({
                    "model_type": "qwen3_5", "vocab_size": 151936,
                }))
                (path / "tokenizer_config.json").write_text(json.dumps(shared_tokenizer))
                (path / "tokenizer.json").write_text(json.dumps({"model": {"vocab": {"hello": 0}}}))
            (target / "model.safetensors").write_bytes(b"target-weights")
            (draft / "model.safetensors").write_bytes(b"draf")
            target_manifest = target / MLX_MODEL_MANIFEST
            target_manifest.write_text(json.dumps({
                "repository": "owner/target", "mtp_repository": "owner/target-mtp",
            }))
            draft_manifest = draft / MLX_MODEL_MANIFEST
            draft_manifest.write_text(json.dumps({
                "repository": "draft-owner/draft", "role": "specprefill",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.OMLX_BASE_DIR", Path(temp_dir) / "omlx"), \
                 patch("services.mlx_runtime._OMLX_CACHE_DIR", Path(temp_dir) / "cache"), \
                 patch("services.mlx_runtime.shutil.which", return_value="/opt/homebrew/bin/omlx"), \
                 patch("services.huggingface_models.search_mlx_models") as search:
                self.assertTrue(prepare_mlx_specprefill_draft(target, enable_mtp=False))
                _, _, mode = _build_omlx_server_command(target, 32768, enable_mtp=False)

            search.assert_not_called()
            settings = json.loads(
                (Path(temp_dir) / "omlx" / "model_settings.json").read_text()
            )["models"]["target"]
            self.assertEqual(mode, "none")
            self.assertFalse(settings["specprefill_enabled"])
            self.assertNotIn("specprefill_draft_model", settings)
            self.assertEqual(
                json.loads(target_manifest.read_text())["specprefill_repository"],
                "draft-owner/draft",
            )
            self.assertEqual(json.loads(draft_manifest.read_text())["role"], "specprefill")

    def test_prepare_specprefill_is_disabled_while_external_mtp_is_enabled(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            target = Path(temp_dir) / "target"
            target.mkdir()
            manifest_path = target / MLX_MODEL_MANIFEST
            manifest_path.write_text(json.dumps({"repository": "owner/target"}))
            with patch(
                "services.mlx_runtime._compatible_external_mtp_path", return_value=Path(temp_dir) / "mtp",
            ), patch("services.mlx_runtime._find_installed_specprefill_draft") as find_installed, \
                 patch("services.huggingface_models.search_mlx_models") as search:
                self.assertFalse(prepare_mlx_specprefill_draft(target, enable_mtp=True))
            find_installed.assert_not_called()
            search.assert_not_called()
            self.assertNotIn("specprefill_repository", json.loads(manifest_path.read_text()))

    def test_every_mlx_load_skips_installed_specprefill_preparation(self):
        model_path = Path("/models/owner/target")
        with patch("services.mlx_runtime.is_apple_silicon", return_value=True), \
             patch("services.vyact_runtime.stop_runtime"), \
             patch("services.mlx_runtime.stop_mlx_runtime"), \
             patch("services.mlx_runtime.prepare_mlx_specprefill_draft") as prepare, \
             patch(
                 "services.mlx_runtime._build_omlx_server_command",
                 side_effect=RuntimeError("settings-built"),
             ):
            with self.assertRaisesRegex(RuntimeError, "settings-built"):
                start_mlx_model(model_path, 65536, enable_mtp=False)

        prepare.assert_not_called()

    def test_external_mtp_load_failure_falls_back_and_records_status(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            models = base / "models"
            model_path = models / "owner" / "target"
            model_path.mkdir(parents=True)
            failed_process = Mock(pid=1234)
            failed_process.poll.return_value = 1
            fallback_process = Mock(pid=1235)
            fallback_process.poll.return_value = None
            status = {}
            with patch("services.mlx_runtime.is_apple_silicon", return_value=True), \
                 patch("services.vyact_runtime.stop_runtime"), \
                 patch("services.mlx_runtime.stop_mlx_runtime"), \
                 patch("services.mlx_runtime._build_omlx_server_command", side_effect=[
                     (["omlx"], {}, "external_mtp"), (["omlx"], {}, "none"),
                 ]), patch("services.mlx_runtime.subprocess.Popen", side_effect=[failed_process, fallback_process]), \
                 patch("services.mlx_runtime.urllib.request.urlopen") as urlopen, \
                 patch("services.mlx_runtime.json.load", return_value={"data": [{"id": "target"}]}), \
                 patch("services.mlx_runtime.get_log_file", return_value=base / "omlx.log"), \
                 patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.mlx_runtime.MLX_RUNTIME_DIR", base), \
                 patch("services.mlx_runtime.MLX_RUNTIME_PID_FILE", base / "omlx.pid"):
                urlopen.return_value.__enter__.return_value.status = 200
                self.assertEqual(
                    start_mlx_model(model_path, 32768, enable_mtp=True, runtime_status=status),
                    "target",
                )

            self.assertTrue(status["mtp_fallback"])
            self.assertEqual(status["mtp_failure_code"], "load_failed")

    def test_prepare_specprefill_skips_installed_draft_that_exceeds_size_ratio(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models = Path(temp_dir) / "models"
            target = models / "owner" / "target"
            draft = models / "owner" / "draft"
            target.mkdir(parents=True)
            draft.mkdir(parents=True)
            for path in (target, draft):
                (path / "config.json").write_text(json.dumps({
                    "model_type": "qwen3_5", "vocab_size": 151936,
                }))
                (path / "tokenizer_config.json").write_text(json.dumps({"tokenizer_class": "Qwen2Tokenizer"}))
                (path / "tokenizer.json").write_text("same-tokenizer")
            (target / "model.safetensors").write_bytes(b"1234567890")
            (draft / "model.safetensors").write_bytes(b"1234")
            (target / MLX_MODEL_MANIFEST).write_text(json.dumps({"repository": "owner/target"}))
            (draft / MLX_MODEL_MANIFEST).write_text(json.dumps({
                "repository": "owner/draft", "role": "specprefill",
            }))

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models), \
                 patch("services.huggingface_models.search_mlx_models", new=AsyncMock(return_value=[])):
                self.assertFalse(prepare_mlx_specprefill_draft(target, enable_mtp=False))

            self.assertNotIn(
                "specprefill_repository",
                json.loads((target / MLX_MODEL_MANIFEST).read_text()),
            )

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

    def test_downloaded_bytes_uses_allocated_file_blocks(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            model_dir = models_dir / "owner" / "model"
            model_dir.mkdir(parents=True)
            model_file = model_dir / "model.safetensors"
            model_file.write_bytes(b"weights")
            expected_bytes = model_file.stat().st_blocks * 512

            with patch("services.mlx_runtime.MLX_MODELS_DIR", models_dir):
                self.assertEqual(get_mlx_downloaded_bytes("owner/model"), expected_bytes)

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
