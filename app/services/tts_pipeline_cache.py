"""Share one acoustic model across language pipelines without importing TTS engines."""
import logging
import threading


logger = logging.getLogger(__name__)
KOKORO_CUDA_INITIALIZATION_ERROR = "Failed to initialize model on CUDA:"


class TtsPipelineCache:
    def __init__(self):
        self._pipelines = {}
        self._lock = threading.Lock()

    def get(self, lang_code, factory, repository):
        with self._lock:
            if lang_code not in self._pipelines:
                model = next((pipeline.model for pipeline in self._pipelines.values()), True)
                try:
                    pipeline = factory(lang_code=lang_code, repo_id=repository, model=model)
                except RuntimeError as error:
                    # Kokoro wraps CUDA model initialization failures with this
                    # prefix. Do not retry dictionary/download errors or move a
                    # model already shared by other language pipelines.
                    if model is not True or not str(error).startswith(KOKORO_CUDA_INITIALIZATION_ERROR):
                        raise
                    logger.warning("Kokoro CUDA initialization failed; retrying on CPU: %s", error)
                    pipeline = factory(lang_code=lang_code, repo_id=repository, model=True, device="cpu")
                self._pipelines[lang_code] = pipeline
            return self._pipelines[lang_code]
