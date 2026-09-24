import tempfile
import unittest
from pathlib import Path

from services.code_tools import _apply_patch, current_code_folders


class CodeApplyPatchPathTests(unittest.IsolatedAsyncioTestCase):
    async def test_file_name_with_spaces(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "file with spaces.txt"
            target.write_text("old\n", encoding="utf-8")
            patch = "--- file with spaces.txt\n+++ file with spaces.txt\n@@ -1 +1 @@\n-old\n+new\n"
            token = current_code_folders.set({"project": str(root)})
            try:
                result = await _apply_patch.__wrapped__("project", patch)
            finally:
                current_code_folders.reset(token)

            self.assertIn("Patch applied", result)
            self.assertEqual(target.read_text(encoding="utf-8"), "new\n")

    async def test_windows_absolute_path_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            patch = "--- C:\\outside.txt\n+++ C:\\outside.txt\n@@ -1 +1 @@\n-old\n+new\n"
            token = current_code_folders.set({"project": directory})
            try:
                result = await _apply_patch.__wrapped__("project", patch)
            finally:
                current_code_folders.reset(token)

            self.assertIn("Patch paths must be relative", result)
