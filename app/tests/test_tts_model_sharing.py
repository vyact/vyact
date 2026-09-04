import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import patch

from routers import tts


class TtsModelSharingTests(unittest.TestCase):
    def test_languages_share_one_model_even_when_requested_concurrently(self):
        created_models = []

        def create_pipeline(*, lang_code, repo_id, model):
            if model is True:
                model = object()
                created_models.append(model)
            return SimpleNamespace(model=model, lang_code=lang_code)

        with patch.object(tts, "_pipelines", {}), patch.object(tts, "KPipeline", side_effect=create_pipeline):
            with ThreadPoolExecutor(max_workers=4) as executor:
                pipelines = list(executor.map(tts._get_pipeline, ["a", "b", "e", "f", "a"]))
            self.assertEqual(len(created_models), 1)
            self.assertTrue(all(p.model is created_models[0] for p in pipelines))
            self.assertIs(pipelines[0], pipelines[-1])

    def test_failed_language_does_not_discard_existing_model(self):
        model = object()
        existing = SimpleNamespace(model=model)
        with patch.object(tts, "_pipelines", {"a": existing}), \
             patch.object(tts, "KPipeline", side_effect=RuntimeError("missing dictionary")):
            with self.assertRaises(tts.HTTPException):
                tts._get_pipeline("j")
            self.assertEqual(tts._pipelines, {"a": existing})


if __name__ == "__main__":
    unittest.main()
