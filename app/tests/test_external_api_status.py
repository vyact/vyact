import io
import unittest
from unittest.mock import AsyncMock, patch

from routers.setup import get_vyact_external_api_status


class VyactExternalApiStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_runtime_model_id_when_server_is_ready(self):
        response = io.BytesIO(b'{"data":[{"id":"vyact-qwen"}]}')
        with patch("routers.setup.load_config_async", AsyncMock(return_value={
            "vyact_config": {"context_size": 65536, "max_output_tokens": 4096},
        })), patch("routers.setup.urllib.request.urlopen", return_value=response):
            status = await get_vyact_external_api_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["endpoint"], "http://127.0.0.1:11435/v1")
        self.assertEqual(status["model_id"], "vyact-qwen")
        self.assertEqual(status["context_window"], 65536)
        self.assertEqual(status["max_tokens"], 4096)
        self.assertEqual(status["network_scope"], "loopback")

    async def test_reports_unavailable_without_guessing_a_model_id(self):
        with patch("routers.setup.load_config_async", AsyncMock(return_value={
            "vyact_config": {"context_size": 32768},
        })), patch("routers.setup.urllib.request.urlopen", side_effect=OSError("offline")):
            status = await get_vyact_external_api_status()

        self.assertFalse(status["available"])
        self.assertIsNone(status["model_id"])
        self.assertEqual(status["max_tokens"], 2048)


if __name__ == "__main__":
    unittest.main()
