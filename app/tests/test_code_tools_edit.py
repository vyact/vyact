import unittest

from services.code_tools import _try_indent_correction


class CodeToolIndentCorrectionTests(unittest.TestCase):
    def test_corrects_internal_indentation_when_outer_indent_matches(self):
        content = 'IGNORE_DIRS = {\n    "node_modules",\n    ".git",\n}'
        old_string = 'IGNORE_DIRS = {\n"node_modules",\n".git",\n}'
        new_string = 'IGNORE_DIRS = {\n    "node_modules",\n    ".git",\n}'

        corrected = _try_indent_correction(content, old_string, new_string)

        self.assertIsNotNone(corrected)
        _, actual_old, corrected_new = corrected
        self.assertEqual(actual_old, content)
        self.assertEqual(corrected_new, new_string)


if __name__ == "__main__":
    unittest.main()
