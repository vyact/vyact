import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.vyact_runtime import (
    RuntimePaths, cache_downloaded_model, get_native_install_commands, get_native_update_commands,
    delete_downloaded_model,
    initialize_downloaded_models_cache, list_downloaded_models, list_mtp_supported_models,
    list_selectable_models, start_single_model,
    uncache_downloaded_model, write_single_model_config,
)


class VyactRuntimeTests(unittest.TestCase):
    def test_deletes_only_the_selected_gguf_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            repository = models_dir / "owner" / "repo"
            repository.mkdir(parents=True)
            selected_model = repository / "model-Q4.gguf"
            other_model = repository / "model-Q8.gguf"
            selected_model.touch()
            other_model.touch()
            with patch("services.vyact_runtime.VYACT_MODELS_DIR", models_dir):
                initialize_downloaded_models_cache(force=True)
                delete_downloaded_model("owner/repo/model-Q4.gguf")

            self.assertFalse(selected_model.exists())
            self.assertTrue(other_model.exists())

    def test_single_model_config_has_one_safe_model_entry(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "model.gguf"
            server = base / "llama-server"
            swap = base / "llama-swap"
            config = base / "llama-swap.yaml"
            for path in (model, server, swap):
                path.touch()
            paths = RuntimePaths(server, swap, base / "models", config)
            with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_MODELS_DIR", base / "models"), \
                 patch("services.vyact_runtime.VYACT_SWAP_CONFIG", config), \
                 patch("services.vyact_runtime.model_has_integrated_mtp", return_value=False):
                key = write_single_model_config(model, 8192)

            contents = config.read_text(encoding="utf-8")
            self.assertTrue(key.startswith("vyact-"))
            self.assertEqual(contents.count("cmd:"), 1)
            self.assertIn("--n-gpu-layers auto", contents)
            self.assertIn("--fit on", contents)
            self.assertIn("--flash-attn auto", contents)
            self.assertIn("--cache-prompt", contents)

    def test_rejects_non_gguf_model(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            file_path = Path(temp_dir) / "model.bin"
            file_path.touch()
            with self.assertRaises(ValueError):
                write_single_model_config(file_path, 8192)

    def test_lists_only_complete_gguf_models(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            (models_dir / "qwen.gguf").touch()
            (models_dir / "partial.gguf.part").touch()
            (models_dir / "notes.txt").touch()
            with patch("services.vyact_runtime.VYACT_MODELS_DIR", models_dir):
                initialize_downloaded_models_cache(force=True)
                self.assertEqual(list_downloaded_models(), ["qwen.gguf"])

                (models_dir / "later.gguf").touch()
                self.assertEqual(list_downloaded_models(), ["qwen.gguf"])

                cache_downloaded_model("owner/later.gguf")
                self.assertEqual(list_downloaded_models(), ["owner/later.gguf", "qwen.gguf"])
                uncache_downloaded_model("qwen.gguf")
                self.assertEqual(list_downloaded_models(), ["owner/later.gguf"])

    def test_mtp_sidecars_are_not_user_selectable_models(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            repository = models_dir / "owner" / "repo"
            repository.mkdir(parents=True)
            (repository / "model-Q4_K_M.gguf").touch()
            (repository / "mtp-model-Q4_0.gguf").touch()
            (repository / "mmproj-F16.gguf").touch()
            embeddings = models_dir / "embeddings"
            embeddings.mkdir()
            (embeddings / "bge-m3-q8_0.gguf").touch()
            with patch("services.vyact_runtime.VYACT_MODELS_DIR", models_dir):
                initialize_downloaded_models_cache(force=True)
                self.assertEqual(list_selectable_models(), ["owner/repo/model-Q4_K_M.gguf"])

    def test_mtp_listing_does_not_inspect_large_model_files(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            models_dir = Path(temp_dir)
            repository = models_dir / "owner" / "repo"
            repository.mkdir(parents=True)
            (repository / "model-Q4_K_M.gguf").touch()
            with patch("services.vyact_runtime.VYACT_MODELS_DIR", models_dir), \
                 patch("services.vyact_runtime.model_has_integrated_mtp") as inspect_model:
                initialize_downloaded_models_cache(force=True)
                self.assertEqual(list_mtp_supported_models(), [])
            inspect_model.assert_not_called()

    def test_macos_installs_only_missing_component_with_brew(self):
        paths = RuntimePaths(None, Path("/opt/homebrew/bin/llama-swap"), Path("/models"), Path("/config"))
        with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
             patch("services.vyact_runtime.platform.system", return_value="Darwin"), \
             patch("services.vyact_runtime.shutil.which", return_value="/opt/homebrew/bin/brew"):
            self.assertEqual(get_native_install_commands(), [["brew", "install", "llama.cpp"]])

    def test_macos_trusts_only_llama_swap_formula_before_install(self):
        paths = RuntimePaths(Path("/opt/homebrew/bin/llama-server"), None, Path("/models"), Path("/config"))
        with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
             patch("services.vyact_runtime.platform.system", return_value="Darwin"), \
             patch("services.vyact_runtime.shutil.which", return_value="/opt/homebrew/bin/brew"):
            self.assertEqual(get_native_install_commands(), [
                ["brew", "tap", "mostlygeek/llama-swap"],
                ["brew", "trust", "--formula", "mostlygeek/llama-swap/llama-swap"],
                ["brew", "install", "mostlygeek/llama-swap/llama-swap"],
            ])

    def test_macos_runtime_updates_are_opt_in_through_brew(self):
        with patch("services.vyact_runtime.platform.system", return_value="Darwin"), \
             patch("services.vyact_runtime.shutil.which", return_value="/opt/homebrew/bin/brew"):
            self.assertEqual(get_native_update_commands(), [["brew", "upgrade", "llama.cpp", "llama-swap"]])

    def test_start_single_model_uses_only_the_managed_swap_binary(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "model.gguf"
            model.touch()
            paths = RuntimePaths(base / "llama-server", base / "llama-swap", base / "models", base / "config.yaml")
            with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
                 patch("services.mlx_runtime.stop_mlx_runtime"), \
                 patch("services.vyact_runtime.stop_runtime"), \
                 patch("services.vyact_runtime.write_single_model_config", return_value="vyact-model") as write_config, \
                 patch("services.vyact_runtime.subprocess.Popen") as popen, \
                 patch("services.vyact_runtime.get_cached_mtp_sidecar", return_value=None), \
                 patch("services.vyact_runtime.get_cached_vision_projector", return_value=None), \
                 patch("services.vyact_runtime.model_has_integrated_mtp", return_value=False), \
                 patch("services.vyact_runtime.urllib.request.urlopen") as urlopen, \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_PID_FILE", base / "runtime.pid"):
                popen.return_value.pid = 1234
                popen.return_value.poll.return_value = None
                urlopen.return_value.__enter__.return_value.status = 200
                self.assertEqual(start_single_model(model, 8192), "vyact-model")
            write_config.assert_called_once_with(
                model, 8192, None, vision_projector_path=None, enable_mtp=False, debug_logging=False,
            )
            self.assertIn("llama-swap", str(popen.call_args.args[0][0]))

    def test_sidecar_config_enables_mtp_with_safe_auto_options(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "model.gguf"
            mtp = base / "mtp-model-Q4_0.gguf"
            server = base / "llama-server"
            swap = base / "llama-swap"
            config = base / "llama-swap.yaml"
            for path in (model, mtp, server, swap):
                path.touch()
            paths = RuntimePaths(server, swap, base / "models", config)
            with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_MODELS_DIR", base / "models"), \
                 patch("services.vyact_runtime.VYACT_SWAP_CONFIG", config):
                write_single_model_config(model, 8192, mtp)

            contents = config.read_text(encoding="utf-8")
            self.assertIn("--spec-draft-model", contents)
            self.assertIn("--spec-type draft-mtp", contents)
            self.assertIn("--spec-draft-ngl auto", contents)

    def test_debug_config_enables_trace_logging_without_verbose_prompt(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "model.gguf"
            server = base / "llama-server"
            swap = base / "llama-swap"
            config = base / "llama-swap.yaml"
            for path in (model, server, swap):
                path.touch()
            paths = RuntimePaths(server, swap, base / "models", config)
            with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_MODELS_DIR", base / "models"), \
                 patch("services.vyact_runtime.VYACT_SWAP_CONFIG", config), \
                 patch("services.vyact_runtime.model_has_integrated_mtp", return_value=False):
                write_single_model_config(model, 8192, debug_logging=True)

            contents = config.read_text(encoding="utf-8")
            self.assertIn("--log-verbosity 4 --log-timestamps", contents)
            self.assertNotIn("--verbose-prompt", contents)

    def test_vision_projector_config_uses_mmproj(self):
        with tempfile.TemporaryDirectory() as temp_dir:
            base = Path(temp_dir)
            model = base / "model-Q4_K_M.gguf"
            projector = base / "mmproj-F16.gguf"
            server = base / "llama-server"
            swap = base / "llama-swap"
            config = base / "llama-swap.yaml"
            for path in (model, projector, server, swap):
                path.touch()
            paths = RuntimePaths(server, swap, base / "models", config)
            with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_MODELS_DIR", base / "models"), \
                 patch("services.vyact_runtime.VYACT_SWAP_CONFIG", config), \
                 patch("services.vyact_runtime.model_has_integrated_mtp", return_value=False):
                write_single_model_config(model, 8192, vision_projector_path=projector)

            contents = config.read_text(encoding="utf-8")
            self.assertIn("--mmproj", contents)
            self.assertIn(str(projector), contents)
