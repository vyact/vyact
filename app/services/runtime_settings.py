"""ES에 저장되는 모델/문서 처리 설정의 런타임 캐시."""
from contextvars import ContextVar
from config.models import (
    BGE_NUM_CTX, HISTORY_CHARS_PER_TOKEN, HISTORY_TOKEN_BUDGET, LLM_INITIAL_NUM_CTX,
    LLM_MAX_NUM_CTX, LLM_MAX_TOKENS, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_TEMPERATURE,
    TOP_K, TOP_P,
)

DEFAULT_RUNTIME_SETTINGS = {
    "llm_temperature": LLM_TEMPERATURE, "llm_num_ctx": LLM_NUM_CTX,
    "llm_num_predict": LLM_NUM_PREDICT, "llm_max_tokens": LLM_MAX_TOKENS,
    "top_k": TOP_K, "top_p": TOP_P,
    "history_token_budget": HISTORY_TOKEN_BUDGET,
    "history_chars_per_token": HISTORY_CHARS_PER_TOKEN,
    "bge_num_ctx": BGE_NUM_CTX,
    "document_chunk_size": 1200, "document_chunk_overlap": 150,
}
_settings = dict(DEFAULT_RUNTIME_SETTINGS)
_request_temperature_override: ContextVar[float | None] = ContextVar(
    "request_temperature_override", default=None
)


def get_runtime_settings() -> dict:
    settings = dict(_settings)
    temperature = _request_temperature_override.get()
    if temperature is not None:
        settings["llm_temperature"] = temperature
    return settings


def set_request_temperature_override(temperature: float):
    """현재 비동기 요청에만 적용할 LLM 온도 오버라이드 토큰을 반환한다."""
    return _request_temperature_override.set(temperature)


def reset_request_temperature_override(token) -> None:
    _request_temperature_override.reset(token)


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
                        _settings[key] = min(max(parsed, LLM_INITIAL_NUM_CTX), LLM_MAX_NUM_CTX) if key == "llm_num_ctx" else parsed
                    except (TypeError, ValueError):
                        pass
    return get_runtime_settings()
