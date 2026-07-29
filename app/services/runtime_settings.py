"""ES에 저장되는 모델/문서 처리 설정의 런타임 캐시."""
from config.models import (
    BGE_NUM_CTX, HISTORY_CHARS_PER_TOKEN, HISTORY_TOKEN_BUDGET,
    LLM_MAX_NUM_CTX, LLM_MAX_TOKENS, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_TEMPERATURE,
    OLLAMA_KEEP_ALIVE, TOP_K, TOP_P,
)

DEFAULT_RUNTIME_SETTINGS = {
    "llm_temperature": LLM_TEMPERATURE, "llm_num_ctx": LLM_NUM_CTX,
    "llm_num_predict": LLM_NUM_PREDICT, "llm_max_tokens": LLM_MAX_TOKENS,
    "top_k": TOP_K, "top_p": TOP_P,
    "history_token_budget": HISTORY_TOKEN_BUDGET,
    "history_chars_per_token": HISTORY_CHARS_PER_TOKEN,
    "ollama_keep_alive": OLLAMA_KEEP_ALIVE, "bge_num_ctx": BGE_NUM_CTX,
    "document_chunk_size": 1200, "document_chunk_overlap": 150,
}
_settings = dict(DEFAULT_RUNTIME_SETTINGS)


def get_runtime_settings() -> dict:
    return dict(_settings)


def apply_runtime_settings(values: dict | None) -> dict:
    if values:
        for key, default in DEFAULT_RUNTIME_SETTINGS.items():
            if key in values:
                val = values[key]
                if val is None or val == '':
                    _settings[key] = None
                else:
                    try:
                        cast_type = type(default) if default is not None else float
                        parsed = cast_type(val)
                        _settings[key] = min(max(parsed, 32768), LLM_MAX_NUM_CTX) if key == "llm_num_ctx" else parsed
                    except (TypeError, ValueError):
                        pass
    return get_runtime_settings()
