"""Share one acoustic model across language pipelines without importing TTS engines."""
import threading


class TtsPipelineCache:
    def __init__(self):
        self._pipelines = {}
        self._lock = threading.Lock()

    def get(self, lang_code, factory, repository):
        with self._lock:
            if lang_code not in self._pipelines:
                model = next((pipeline.model for pipeline in self._pipelines.values()), True)
                pipeline = factory(lang_code=lang_code, repo_id=repository, model=model)
                self._pipelines[lang_code] = pipeline
            return self._pipelines[lang_code]
