import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock

from services.tts_pipeline_cache import TtsPipelineCache


class TtsModelSharingTests(unittest.TestCase):
    def test_languages_share_one_model_even_when_requested_concurrently(self):
        created_models = []

        def create_pipeline(*, lang_code, repo_id, model):
            if model is True:
                model = object()
                created_models.append(model)
            return SimpleNamespace(model=model, lang_code=lang_code)

        cache = TtsPipelineCache()
        with ThreadPoolExecutor(max_workers=4) as executor:
            pipelines = list(executor.map(
                lambda language: cache.get(language, create_pipeline, "test/repository"),
                ["a", "b", "e", "f", "a"],
            ))
        self.assertEqual(len(created_models), 1)
        self.assertTrue(all(p.model is created_models[0] for p in pipelines))
        self.assertIs(pipelines[0], pipelines[-1])

    def test_failed_language_does_not_discard_existing_model(self):
        model = object()
        existing = SimpleNamespace(model=model)
        cache = TtsPipelineCache()
        cache.get("a", Mock(return_value=existing), "test/repository")
        failing_factory = Mock(side_effect=RuntimeError("missing dictionary"))
        with self.assertRaises(RuntimeError):
            cache.get("j", failing_factory, "test/repository")
        self.assertIs(cache.get("a", failing_factory, "test/repository"), existing)
        recovered = Mock(return_value=SimpleNamespace(model=model))
        cache.get("j", recovered, "test/repository")
        self.assertIs(recovered.call_args.kwargs["model"], model)



if __name__ == "__main__":
    unittest.main()
