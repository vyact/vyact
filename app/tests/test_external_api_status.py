import io
import unittest
from unittest.mock import AsyncMock, patch

from routers.setup import ExternalApiAuthRequest, get_vyact_external_api_status, regenerate_vyact_external_api_token, update_vyact_external_api_auth


class VyactExternalApiStatusTests(unittest.IsolatedAsyncioTestCase):
    async def test_returns_runtime_model_id_when_server_is_ready(self):
        response = io.BytesIO(b'{"data":[{"id":"vyact-qwen"}]}')
        with patch("routers.setup.load_config_async", AsyncMock(return_value={
            "vyact_config": {"model": "vyact-qwen", "context_size": 65536, "max_output_tokens": 4096},
        })), patch("routers.setup.urllib.request.urlopen", return_value=response):
            status = await get_vyact_external_api_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["endpoint"], "http://127.0.0.1:11436/v1")
        self.assertEqual(status["model_id"], "vyact-qwen")
        self.assertEqual(status["context_window"], 65536)
        self.assertEqual(status["max_tokens"], 4096)
        self.assertEqual(status["network_scope"], "lan")
        self.assertFalse(status["auth_enabled"])

    async def test_selects_configured_chat_model_instead_of_first_runtime_model(self):
        response = io.BytesIO(b'{"data":[{"id":"BAAI/bge-reranker-v2-m3"},{"id":"vyact-qwen"}]}')
        with patch("routers.setup.load_config_async", AsyncMock(return_value={
            "model": "vyact-qwen", "vyact_config": {},
        })), patch("routers.setup.urllib.request.urlopen", return_value=response):
            status = await get_vyact_external_api_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["model_id"], "vyact-qwen")

    async def test_exposes_repository_id_for_mlx_model(self):
        model_path = "/Users/test/.vyact/models/mlx/owner/model"
        response = io.BytesIO(f'{{"data":[{{"id":"{model_path}"}}]}}'.encode())
        with patch("routers.setup.load_config_async", AsyncMock(return_value={
            "model": model_path,
            "vyact_config": {"model": model_path, "model_path": "mlx/owner/model", "runtime": "mlx"},
        })), patch("routers.setup.urllib.request.urlopen", return_value=response):
            status = await get_vyact_external_api_status()

        self.assertTrue(status["available"])
        self.assertEqual(status["model_id"], "owner/model")

    async def test_enabling_auth_generates_and_persists_token(self):
        config = {"external_api": {}}
        save = AsyncMock()
        with patch("routers.setup.load_config_async", AsyncMock(return_value=config)), \
                patch("routers.setup.save_config_async", save):
            result = await update_vyact_external_api_auth(ExternalApiAuthRequest(enabled=True))

        self.assertTrue(result["auth_enabled"])
        self.assertGreater(len(result["api_token"]), 32)
        save.assert_awaited_once_with(config)

    async def test_regenerating_auth_token_replaces_existing_value(self):
        config = {"external_api": {"auth_enabled": True, "api_token": "old"}}
        with patch("routers.setup.load_config_async", AsyncMock(return_value=config)), \
                patch("routers.setup.save_config_async", AsyncMock()):
            result = await regenerate_vyact_external_api_token()

        self.assertNotEqual(result["api_token"], "old")

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
