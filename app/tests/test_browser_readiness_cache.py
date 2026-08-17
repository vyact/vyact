import unittest
from unittest.mock import AsyncMock, patch

from services import browser_tools


class BrowserReadinessCacheTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.folder_token = browser_tools.current_code_folders.set({"project": "/tmp/project"})
        browser_tools._page_readiness_cache.set(None)

    async def asyncTearDown(self):
        browser_tools._page_readiness_cache.set(None)
        browser_tools.current_code_folders.reset(self.folder_token)

    async def test_reuses_readiness_for_same_loaded_page(self):
        async def execute(command, **_args):
            if command == "wait_ready":
                return {"url": "https://example.com/product", "contentReady": True}
            if command == "status":
                return {"url": "https://example.com/product", "loading": False}
            return {"command": command}

        command_mock = AsyncMock(side_effect=execute)
        with patch.object(browser_tools, "_electron_command", command_mock):
            await browser_tools._command("inspect")
            await browser_tools._command("read")

        self.assertEqual(
            [call.args[0] for call in command_mock.await_args_list],
            ["wait_ready", "inspect", "status", "read"],
        )

    async def test_click_invalidates_cached_readiness(self):
        async def execute(command, **_args):
            if command == "wait_ready":
                return {"url": "https://example.com/product", "contentReady": True}
            return {"url": "https://example.com/product", "loading": False}

        command_mock = AsyncMock(side_effect=execute)
        with patch.object(browser_tools, "_electron_command", command_mock):
            await browser_tools._command("read")
            await browser_tools._command("click", element_id="vyact-1")
            await browser_tools._command("inspect")

        commands = [call.args[0] for call in command_mock.await_args_list]
        self.assertEqual(commands.count("wait_ready"), 2)


if __name__ == "__main__":
    unittest.main()
