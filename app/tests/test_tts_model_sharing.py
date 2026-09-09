import unittest
from concurrent.futures import ThreadPoolExecutor
from types import SimpleNamespace
from unittest.mock import Mock, call

from services.tts_pipeline_cache import TtsPipelineCache


class TtsModelSharingTests(unittest.TestCase):
    def test_cuda_initialization_failure_retries_on_cpu_and_shares_recovered_model(self):
        model = object()
        cpu_pipeline = SimpleNamespace(model=model)
        second_language = SimpleNamespace(model=model)
        factory = Mock(side_effect=[
            RuntimeError("Failed to initialize model on CUDA: cuDNN version 92400 is not compatible with devices with SM < 7.5."),
            cpu_pipeline,
            second_language,
        ])
        cache = TtsPipelineCache()

        self.assertIs(cache.get("a", factory, "test/repository"), cpu_pipeline)
        self.assertIs(cache.get("a", factory, "test/repository"), cpu_pipeline)
        self.assertIs(cache.get("b", factory, "test/repository"), second_language)
        self.assertEqual(factory.call_args_list, [
            call(lang_code="a", repo_id="test/repository", model=True),
            call(lang_code="a", repo_id="test/repository", model=True, device="cpu"),
            call(lang_code="b", repo_id="test/repository", model=model),
        ])

    def test_successful_initialization_keeps_default_device_selection(self):
        pipeline = SimpleNamespace(model=object())
        factory = Mock(return_value=pipeline)
        cache = TtsPipelineCache()
        self.assertIs(cache.get("a", factory, "test/repository"), pipeline)
        factory.assert_called_once_with(lang_code="a", repo_id="test/repository", model=True)

    def test_unrelated_initialization_errors_are_not_retried(self):
        for error in (RuntimeError("model download failed"), ModuleNotFoundError("missing dictionary")):
            with self.subTest(error=error):
                factory = Mock(side_effect=error)
                with self.assertRaises(type(error)):
                    TtsPipelineCache().get("a", factory, "test/repository")
                self.assertEqual(factory.call_count, 1)

    def test_failed_cpu_retry_does_not_cache_broken_pipeline(self):
        cpu_error = RuntimeError("CPU model initialization failed")
        factory = Mock(side_effect=[
            RuntimeError("Failed to initialize model on CUDA: no kernel image is available"),
            cpu_error,
        ])
        cache = TtsPipelineCache()
        with self.assertRaises(RuntimeError) as raised:
            cache.get("a", factory, "test/repository")
        self.assertIs(raised.exception, cpu_error)
        recovered = SimpleNamespace(model=object())
        self.assertIs(cache.get("a", Mock(return_value=recovered), "test/repository"), recovered)

    def test_existing_shared_model_is_not_replaced_after_cuda_error(self):
        cache = TtsPipelineCache()
        existing = SimpleNamespace(model=object())
        cache.get("a", Mock(return_value=existing), "test/repository")
        factory = Mock(side_effect=RuntimeError("Failed to initialize model on CUDA: failure"))
        with self.assertRaises(RuntimeError):
            cache.get("b", factory, "test/repository")
        self.assertEqual(factory.call_count, 1)
        self.assertIs(cache.get("a", factory, "test/repository"), existing)

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
