import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from services.code_tools import _grep_search, current_code_folders


class CodeSearchBoundaryTests(unittest.IsolatedAsyncioTestCase):
    async def test_recursive_search_reads_only_in_root_targets(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'project'
            root.mkdir()
            inside = root / 'inside.txt'
            inside.write_text('MATCH internal', encoding='utf-8')
            outside = Path(directory) / 'secret.txt'
            outside.write_text('MATCH external secret', encoding='utf-8')
            (root / 'external.txt').symlink_to(outside)
            (root / 'internal-link.txt').symlink_to(inside)
            (root / 'broken.txt').symlink_to(root / 'missing.txt')
            (root / 'loop.txt').symlink_to(root / 'loop.txt')
            original_read = Path.read_text
            reads = []

            def record_read(path, *args, **kwargs):
                reads.append(path)
                return original_read(path, *args, **kwargs)

            token = current_code_folders.set({'project': str(root)})
            try:
                with patch.object(Path, 'read_text', record_read):
                    result = await _grep_search.__wrapped__('project', 'MATCH', include='*.txt')
            finally:
                current_code_folders.reset(token)

            self.assertIn('inside.txt:1:MATCH internal', result)
            self.assertIn('internal-link.txt:1:MATCH internal', result)
            self.assertNotIn('external secret', result)
            self.assertNotIn(outside, reads)
            self.assertTrue(reads)
            self.assertTrue(all(path.is_relative_to(root.resolve()) for path in reads))
