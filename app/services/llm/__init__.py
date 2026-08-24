"""
services/llm — LLM 쿼리 패키지 (Vyact / OpenAI / Gemini / Claude)

기존 `from services.llm import ...` 호환을 위해 공개 API를 재노출한다.

구성:
  config.py    — provider 설정, 상수, 로깅
  helpers.py   — 이미지/mime/rag/history 변환
  errors.py    — provider HTTP 에러 메시지
  tools.py     — MCP tool → provider 스키마 변환 + tool 지시문
  providers.py — OpenAI/Gemini/Claude tool 루프 + 스트리밍
  prepare.py   — provider 요청 공통 준비
  core.py      — chat_stream_with_tools / query_llm (진입점)
"""
from .config import get_model_display_name, get_provider_config, get_model_name, log_llm_interaction
from .core import chat_stream_with_tools, collect_llm_stream, query_llm

__all__ = [
    "chat_stream_with_tools",
    "collect_llm_stream",
    "query_llm",
    "get_provider_config",
    "get_model_name",
    "get_model_display_name",
    "log_llm_interaction",
]
