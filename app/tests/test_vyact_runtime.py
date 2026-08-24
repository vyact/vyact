import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.vyact_runtime import (
    RuntimePaths, cache_downloaded_model, get_native_install_commands, get_native_update_commands,
    initialize_downloaded_models_cache, list_downloaded_models, start_single_model,
    uncache_downloaded_model, write_single_model_config,
)


class VyactRuntimeTests(unittest.TestCase):
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
                 patch("services.vyact_runtime.VYACT_SWAP_CONFIG", config):
                key = write_single_model_config(model, 8192)

            contents = config.read_text(encoding="utf-8")
            self.assertTrue(key.startswith("vyact-"))
            self.assertEqual(contents.count("cmd:"), 1)
            self.assertIn("--n-gpu-layers 99", contents)

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

    def test_macos_installs_only_missing_component_with_brew(self):
        paths = RuntimePaths(None, Path("/opt/homebrew/bin/llama-swap"), Path("/models"), Path("/config"))
        with patch("services.vyact_runtime.get_runtime_paths", return_value=paths), \
             patch("services.vyact_runtime.platform.system", return_value="Darwin"), \
             patch("services.vyact_runtime.shutil.which", return_value="/opt/homebrew/bin/brew"):
            self.assertEqual(get_native_install_commands(), [["brew", "install", "llama.cpp"]])

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
                 patch("services.vyact_runtime.stop_runtime"), \
                 patch("services.vyact_runtime.write_single_model_config", return_value="vyact-model") as write_config, \
                 patch("services.vyact_runtime.subprocess.Popen") as popen, \
                 patch("services.vyact_runtime.VYACT_RUNTIME_DIR", base), \
                 patch("services.vyact_runtime.VYACT_RUNTIME_PID_FILE", base / "runtime.pid"):
                popen.return_value.pid = 1234
                self.assertEqual(start_single_model(model, 8192), "vyact-model")
            write_config.assert_called_once_with(model, 8192)
            self.assertIn("llama-swap", str(popen.call_args.args[0][0]))
