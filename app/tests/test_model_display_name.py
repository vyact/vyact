import unittest
from unittest.mock import AsyncMock, patch

from services.llm.config import get_model_display_name


class ModelDisplayNameTests(unittest.IsolatedAsyncioTestCase):
    async def test_mlx_model_displays_name_without_repository_or_local_path(self):
        with (
            patch("services.llm.config.get_provider_config", AsyncMock(return_value={
                "selection_type": "vyact",
                "model": "/Users/alex/.vyact/models/mlx/Qwen/Qwen3.5-4B",
            })),
            patch("routers.deps.load_config_async", AsyncMock(return_value={
                "vyact_config": {
                    "runtime": "mlx",
                    "model_path": "mlx/Qwen/Qwen3.5-4B",
                    "repository": None,
                },
            })),
        ):
            display_name = await get_model_display_name()

        self.assertEqual(display_name, "Qwen3.5-4B")


if __name__ == "__main__":
    unittest.main()
