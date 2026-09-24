import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.code_tools import _list_directory, build_project_manifest, current_code_folders


class CodeDirectoryAccessTests(unittest.IsolatedAsyncioTestCase):
    async def test_depth_limit_is_visible_in_result(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "nested").mkdir()
            (root / "nested" / "hidden.txt").write_text("x", encoding="utf-8")
            token = current_code_folders.set({"project": str(root)})
            try:
                listing = await _list_directory.__wrapped__("project", max_depth=0)
            finally:
                current_code_folders.reset(token)

            self.assertIn("nested/", listing)
            self.assertNotIn("hidden.txt", listing)
            self.assertIn("output truncated", listing)

    async def test_directory_symlink_does_not_leave_registered_folder(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "project"
            root.mkdir()
            outside = Path(directory) / "outside"
            outside.mkdir()
            (outside / "secret.txt").write_text("secret", encoding="utf-8")
            try:
                (root / "linked folder").symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Creating symlinks requires additional permissions on this platform")
            token = current_code_folders.set({"project": str(root)})
            try:
                listing = await _list_directory.__wrapped__("project")
            finally:
                current_code_folders.reset(token)

            self.assertIn("linked folder", listing)
            self.assertIn("symbolic link skipped", listing)
            self.assertNotIn("secret.txt", listing)

    async def test_internal_directory_symlink_is_traversed_without_looping(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "target"
            target.mkdir()
            (target / "visible.txt").write_text("ok", encoding="utf-8")
            try:
                (root / "alias").symlink_to(target, target_is_directory=True)
                (target / "loop").symlink_to(root, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest("Creating symlinks requires additional permissions on this platform")
            token = current_code_folders.set({"project": str(root)})
            try:
                listing = await _list_directory.__wrapped__("project")
            finally:
                current_code_folders.reset(token)

            self.assertIn("alias/", listing)
            self.assertIn("visible.txt", listing)
            self.assertIn("symbolic link skipped", listing)
            self.assertLess(len(listing), 1000)

    async def test_inaccessible_child_does_not_hide_siblings(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            blocked = root / "blocked child"
            blocked.mkdir()
            (root / "visible child").mkdir()
            (root / "visible child" / "file.txt").write_text("ok", encoding="utf-8")
            original_iterdir = Path.iterdir

            def list_entries(path):
                if path.resolve() == blocked.resolve():
                    raise PermissionError(13, "Access denied", str(path))
                return original_iterdir(path)

            token = current_code_folders.set({"project": str(root)})
            try:
                with patch.object(Path, "iterdir", list_entries):
                    listing = await _list_directory.__wrapped__("project")
                    manifest = build_project_manifest([str(root)])
            finally:
                current_code_folders.reset(token)

            self.assertIn("blocked child/", listing)
            self.assertIn("blocked child", listing)
            self.assertIn("file.txt", listing)
            self.assertIn("(unavailable)", manifest)
            self.assertIn("file.txt", manifest)
