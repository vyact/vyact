import asyncio
import unittest

from services.extension_browser import CHROME_STORE_URL, ExtensionBrowserBridge


class ExtensionBrowserBridgeTests(unittest.IsolatedAsyncioTestCase):
    async def test_command_round_trip(self):
        bridge = ExtensionBrowserBridge()
        bridge.register()

        async def extension_worker():
            command = await bridge.next_command(1)
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
