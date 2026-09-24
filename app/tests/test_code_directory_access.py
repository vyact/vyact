import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.code_tools import _list_directory, build_project_manifest, current_code_folders


class CodeDirectoryAccessTests(unittest.IsolatedAsyncioTestCase):
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
