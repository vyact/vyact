import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.code_tools import _file_inventory, _find_files, _grep_search, _list_tasks, current_code_folders


class CodeFileInventoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_size_and_modified_queries_cover_nested_paths_with_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            nested = root / "folder with spaces"
            nested.mkdir()
            (root / "small.txt").write_bytes(b"a")
            (nested / "large file.txt").write_bytes(b"a" * 20)
            token = current_code_folders.set({"project": str(root)})
            try:
                largest = json.loads(await _file_inventory.__wrapped__("project"))
                newest = json.loads(await _file_inventory.__wrapped__("project", sort_by="modified"))
                small = json.loads(await _file_inventory.__wrapped__("project", max_size_bytes=1))
            finally:
                current_code_folders.reset(token)

            self.assertTrue(largest["complete"])
            self.assertEqual(largest["files"][0]["path"], "folder with spaces/large file.txt")
            self.assertEqual(largest["files"][0]["size_bytes"], 20)
            self.assertEqual(largest["matched_files"], 2)
            self.assertIn("modified_utc", newest["files"][0])
            self.assertEqual([item["path"] for item in small["files"]], ["small.txt"])

    async def test_inaccessible_child_is_reported_and_siblings_remain(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked = root / "blocked child"
            blocked.mkdir()
            (root / "visible.txt").write_bytes(b"ok")
            original_scandir = os.scandir

            def scan(path):
                if Path(path).resolve() == blocked.resolve():
                    raise PermissionError(13, "Access denied", str(path))
                return original_scandir(path)

            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools.os.scandir", side_effect=scan):
                    result = json.loads(await _file_inventory.__wrapped__("project"))
            finally:
                current_code_folders.reset(token)

            self.assertFalse(result["complete"])
            self.assertIn("blocked child", result["skipped_paths"])
            self.assertEqual(result["files"][0]["path"], "visible.txt")

    async def test_symlink_is_not_followed(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            outside = Path(directory) / "outside.txt"
            outside.write_bytes(b"secret")
            try:
                (root / "outside link").symlink_to(outside)
            except (OSError, NotImplementedError):
                self.skipTest("Creating symlinks requires additional permissions on this platform")
            token = current_code_folders.set({"project": str(root)})
            try:
                result = json.loads(await _file_inventory.__wrapped__("project"))
            finally:
                current_code_folders.reset(token)

            self.assertFalse(result["complete"])
            self.assertEqual(result["files"], [])
            self.assertIn("outside link", result["skipped_paths"])

    async def test_internal_symlink_is_traversed_and_cycle_is_reported(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "visible.txt").write_bytes(b"hello")
            try:
                (root / "alias").symlink_to(target, target_is_directory=True)
                (target / "loop").symlink_to(root, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Creating symlinks requires additional permissions on this platform")
            token = current_code_folders.set({"project": str(root)})
            try:
                result = json.loads(await _file_inventory.__wrapped__("project"))
            finally:
                current_code_folders.reset(token)

            self.assertIn("alias/visible.txt", [item["path"] for item in result["files"]])
            self.assertEqual(result["unique_files"], 1)
            self.assertTrue(next(item for item in result["files"] if item["path"] == "alias/visible.txt")["via_symlink"])
            self.assertFalse(result["complete"])
            self.assertTrue(any(path.endswith("loop") for path in result["skipped_paths"]))

    async def test_name_and_content_search_report_inaccessible_subfolder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "visible.txt").write_text("MATCH", encoding="utf-8")
            blocked = root / "blocked child"
            blocked.mkdir()
            original_walk = os.walk

            def walk(path, *args, **kwargs):
                yield from original_walk(path, *args, **kwargs)
                kwargs["onerror"](PermissionError(13, "Access denied", str(blocked)))

            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools.os.walk", side_effect=walk):
                    names = await _find_files.__wrapped__("project", "*.txt")
                    contents = await _grep_search.__wrapped__("project", "MATCH")
            finally:
                current_code_folders.reset(token)

            self.assertIn("visible.txt", names)
            self.assertIn("blocked child", names)
            self.assertIn("visible.txt:1:MATCH", contents)
            self.assertIn("blocked child", contents)

    async def test_task_listing_reports_inaccessible_subfolder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked = root / "blocked child"
            blocked.mkdir()
            original_walk = os.walk

            def walk(path, *args, **kwargs):
                yield from original_walk(path, *args, **kwargs)
                kwargs["onerror"](PermissionError(13, "Access denied", str(blocked)))

            token = current_code_folders.set({"project": str(root)})
            try:
                with patch("services.code_tools.os.walk", side_effect=walk):
                    result = await _list_tasks.__wrapped__("project")
            finally:
                current_code_folders.reset(token)

            self.assertIn("No runnable project tasks", result)
            self.assertIn("blocked child", result)
