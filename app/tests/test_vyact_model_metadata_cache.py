import unittest

from services.vyact_model_metadata_cache import build_model_metadata_id


class VyactModelMetadataCacheTests(unittest.TestCase):
    def test_model_metadata_id_is_stable(self):
        first = build_model_metadata_id("owner/model", "model-Q4.gguf", "abc123", 32768)
        second = build_model_metadata_id("owner/model", "model-Q4.gguf", "abc123", 32768)
        self.assertEqual(first, second)
        self.assertEqual(len(first), 64)

    def test_model_metadata_id_changes_with_file_revision_or_context(self):
        baseline = build_model_metadata_id("owner/model", "model-Q4.gguf", "abc123", 32768)
        variants = (
            build_model_metadata_id("owner/model", "model-Q5.gguf", "abc123", 32768),
            build_model_metadata_id("owner/model", "model-Q4.gguf", "def456", 32768),
            build_model_metadata_id("owner/model", "model-Q4.gguf", "abc123", 65536),
        )
        self.assertTrue(all(candidate != baseline for candidate in variants))
