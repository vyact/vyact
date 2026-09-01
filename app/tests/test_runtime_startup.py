import asyncio
import unittest
from unittest.mock import AsyncMock, patch

from services import runtime_startup


class RuntimeStartupTests(unittest.TestCase):
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
            "model-id", "ko", "Custom system prompt summary",
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


if __name__ == "__main__":
    unittest.main()
