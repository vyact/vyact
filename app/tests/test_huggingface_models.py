import unittest

from services.huggingface_models import (
    RECOMMENDED_GGUF_REPOSITORIES,
    _model_from_hub_item,
    _safe_relative_file_path,
)


class HuggingFaceModelTests(unittest.TestCase):
    def test_accepts_repository_relative_gguf_path(self):
        self.assertEqual(str(_safe_relative_file_path("Q4/model.gguf")), "Q4/model.gguf")

    def test_rejects_path_traversal_and_non_gguf_files(self):
        for filename in ("../model.gguf", "/model.gguf", "model.bin"):
            with self.assertRaises(ValueError):
                _safe_relative_file_path(filename)

    def test_recommended_models_cover_small_medium_and_large_choices(self):
        self.assertEqual(len(RECOMMENDED_GGUF_REPOSITORIES), 3)
        self.assertTrue(any("4B" in repo_id for repo_id in RECOMMENDED_GGUF_REPOSITORIES))
        self.assertTrue(any("9B" in repo_id for repo_id in RECOMMENDED_GGUF_REPOSITORIES))

    def test_hub_item_keeps_only_gguf_files(self):
        model = _model_from_hub_item({
            "id": "owner/model-GGUF",
            "sha": "abc123",
            "downloads": 12,
            "siblings": [{"rfilename": "model.gguf", "size": 1024}, {"rfilename": "README.md"}],
        })
        self.assertEqual(model, {
            "id": "owner/model-GGUF", "revision": "abc123", "downloads": 12,
            "files": ["model.gguf"], "file_sizes": {"model.gguf": 1024},
        })
