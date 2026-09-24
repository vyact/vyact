import json
import ntpath
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from services.filesystem_tree_fallback import recover_directory_tree
from services.mcp_client import MCPManager


def _result(text: str = "", *, error: bool = False):
    return SimpleNamespace(isError=error, content=[SimpleNamespace(type="text", text=text)])


class _Session:
    def __init__(self):
        self.calls = []

    async def call_tool(self, name, arguments):
        self.calls.append((name, arguments))
        if name == "directory_tree":
            return _result("Access denied", error=True)
        responses = {
            "C:\\Project A": _result("[DIR] blocked child\n[DIR] visible child\n[FILE] root.txt"),
            "C:\\Project A\\blocked child": _result("Access denied", error=True),
            "C:\\Project A\\visible child": _result("[FILE] file.txt"),
        }
        return responses[arguments["path"]]


class FilesystemTreeFallbackTests(unittest.IsolatedAsyncioTestCase):
    async def test_skips_inaccessible_child_and_keeps_siblings(self):
        session = _Session()
        # On non-Windows hosts, os.path.join does not use Windows separators.
        with patch("services.filesystem_tree_fallback.os.path.join", ntpath.join):
            result = await recover_directory_tree(session, "C:\\Project A", [])

        tree = json.loads(result)
        self.assertEqual(tree[0], {
            "name": "blocked child", "type": "directory", "children": [], "unavailable": True,
        })
        self.assertEqual(tree[1]["children"], [{"name": "file.txt", "type": "file"}])
        self.assertEqual(tree[2], {"name": "root.txt", "type": "file"})
        self.assertEqual(len(session.calls), 3)

    async def test_root_failure_stays_failure(self):
        class DeniedSession:
            async def call_tool(self, name, arguments):
                return _result("Access denied", error=True)

        self.assertIsNone(await recover_directory_tree(DeniedSession(), "/blocked", []))

    async def test_mcp_manager_recovers_failed_filesystem_tree(self):
        session = _Session()
        manager = MCPManager()
        manager._workers["filesystem"] = SimpleNamespace(
            cfg={"_server_type": "filesystem"},
            server=SimpleNamespace(session=session),
        )
        with patch("services.filesystem_tree_fallback.os.path.join", ntpath.join):
            result = await manager.call_tool("filesystem__directory_tree", {"path": "C:\\Project A"})

        self.assertTrue(json.loads(result)[0]["unavailable"])
        self.assertEqual(session.calls[0][0], "directory_tree")
