import asyncio
import unittest

from services.extension_browser import CHROME_STORE_URL, ExtensionBrowserBridge


class ExtensionBrowserBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_round_trip(self):
        bridge = ExtensionBrowserBridge()
        sent = asyncio.Queue()

        class FakeWebSocket:
            async def send_json(self, message):
                await sent.put(message)

        websocket = FakeWebSocket()
        bridge.attach(websocket)

        async def extension_worker():
            command = await sent.get()
            bridge.complete(command["id"], {"ok": True, "result": {"url": "https://example.com"}})

        worker = asyncio.create_task(extension_worker())
        result = await bridge.execute("status")
        await worker
        self.assertEqual(result["url"], "https://example.com")

    async def test_disconnected_error_contains_install_link(self):
        bridge = ExtensionBrowserBridge()
        with self.assertRaisesRegex(RuntimeError, CHROME_STORE_URL.replace("?", "\\?")):
            await bridge.execute("status")


if __name__ == "__main__":
    unittest.main()
