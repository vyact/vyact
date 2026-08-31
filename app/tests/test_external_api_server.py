import unittest
from unittest.mock import AsyncMock, patch

import httpx

from services.external_api_server import external_api_app, public_model_id, rewrite_request_model


class ExternalApiServerTests(unittest.IsolatedAsyncioTestCase):
    def test_public_model_id_hides_local_mlx_path(self):
        config = {"vyact_config": {
            "model": "/Users/test/.vyact/models/mlx/owner/model",
            "model_path": "mlx/owner/model",
        }}
        self.assertEqual(public_model_id(config), "owner/model")

    def test_public_model_id_is_rewritten_to_internal_runtime_model(self):
        config = {"vyact_config": {
            "model": "/Users/test/.vyact/models/mlx/owner/model",
            "model_path": "mlx/owner/model",
        }}
        body = rewrite_request_model(
            b'{"model":"owner/model","messages":[]}', "application/json", config,
        )
        self.assertIn(b'/Users/test/.vyact/models/mlx/owner/model', body)

    async def test_token_is_required_for_local_requests_when_enabled(self):
        context = ({"vyact_config": {"model_path": "owner/model"}}, {
            "auth_enabled": True, "api_token": "secret",
        })
        transport = httpx.ASGITransport(app=external_api_app)
        with patch("services.external_api_server._load_external_api_context", AsyncMock(return_value=context)):
            async with httpx.AsyncClient(transport=transport, base_url="http://127.0.0.1") as client:
                denied = await client.get("/v1/models")
                allowed = await client.get("/v1/models", headers={"Authorization": "Bearer secret"})

        self.assertEqual(denied.status_code, 401)
        self.assertEqual(allowed.status_code, 200)
        self.assertEqual(allowed.json()["data"][0]["id"], "owner/model")


if __name__ == "__main__":
    unittest.main()
