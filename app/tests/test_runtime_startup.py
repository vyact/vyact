import asyncio
import unittest
from unittest.mock import AsyncMock, Mock, patch

from services import runtime_startup


class RuntimeStartupTests(unittest.TestCase):
    def test_saved_seed_is_reapplied_when_local_model_is_restored(self):
        profile = runtime_startup.recommended_model_profile(
            "owner/model.gguf", "gguf", "owner/model", 32768,
        )
        profile.update({
            "seed": 42,
            "mtp_enabled": False,
            "kv_cache_precision": "none",
            "cache_quantization": False,
        })
        apply_settings = Mock()
        config = {
            "type": "vyact",
            "runtime_settings": {},
            "vyact_config": {"runtime": "gguf", "model_path": "owner/model.gguf"},
        }
        with patch.object(
            runtime_startup, "load_config_async", new=AsyncMock(return_value=config),
        ), patch.object(
            runtime_startup, "get_model_profile", new=AsyncMock(return_value=profile),
        ), patch.object(
            runtime_startup, "start_configured_runtime", return_value="model-id",
        ), patch.object(
            runtime_startup, "apply_runtime_settings", new=apply_settings,
        ), patch.object(
            runtime_startup, "save_config_async", new=AsyncMock(),
        ), patch.object(
            runtime_startup, "load_ui_language_async", new=AsyncMock(return_value="ko"),
        ):
            result = asyncio.run(runtime_startup.load_configured_vyact_model())

        self.assertEqual(result, ("model-id", "ko"))
        self.assertEqual(apply_settings.call_args.args[0]["seed"], 42)

    def test_warms_loaded_model_with_the_shared_chat_prefix(self):
        warmup = AsyncMock(return_value=True)
        with patch(
            "routers.chat_helpers.load_system_prompt",
            new=AsyncMock(return_value=("", "", "Custom system prompt")),
        ), patch(
            "services.conv_summary.build_summary_instruction", return_value=" summary",
        ), patch(
            "services.llm.warmup.warm_vyact_chat_prefix", new=warmup,
        ):
            result = asyncio.run(runtime_startup.warm_loaded_vyact_model("model-id", "ko"))

        self.assertTrue(result)
        warmup.assert_awaited_once_with(
            "model-id", "ko", "Custom system prompt summary", raise_on_error=True,
        )

    def test_startup_update_choice_warms_after_model_load(self):
        load_model = AsyncMock(return_value=("model-id", "en"))
        warmup = AsyncMock(return_value=True)
        with patch.object(
            runtime_startup, "_startup_state", {"status": "update_available", "packages": []},
        ), patch.object(
            runtime_startup, "load_config_async", new=AsyncMock(return_value={
                "type": "vyact", "vyact_config": {"runtime": "mlx", "model_path": "mlx/model"},
            }),
        ), patch.object(
            runtime_startup, "get_runtime_update_commands", return_value=[],
        ), patch.object(
            runtime_startup, "load_configured_vyact_model", new=load_model,
        ), patch.object(
            runtime_startup, "warm_loaded_vyact_model", new=warmup,
        ):
            result = asyncio.run(runtime_startup.apply_startup_runtime_choice(False))

        self.assertEqual(result, ("model-id", "en"))
        warmup.assert_awaited_once_with("model-id", "en")

    def test_startup_update_choice_exposes_warmup_failure(self):
        load_model = AsyncMock(return_value=("model-id", "en"))
        warmup = AsyncMock(side_effect=RuntimeError(
            "does not fit under the dynamic memory ceiling",
        ))
        state = {"status": "update_available", "packages": []}
        with patch.object(runtime_startup, "_startup_state", state), patch.object(
            runtime_startup, "load_configured_vyact_model", new=load_model,
        ), patch.object(
            runtime_startup, "warm_loaded_vyact_model", new=warmup,
        ):
            with self.assertRaisesRegex(RuntimeError, "model_insufficient_memory"):
                asyncio.run(runtime_startup.apply_startup_runtime_choice(False))

            self.assertEqual(runtime_startup.get_startup_runtime_state(), {
                "status": "load_failed",
                "packages": [],
                "error_code": "model_insufficient_memory",
                "model": "model-id",
            })


if __name__ == "__main__":
    unittest.main()
