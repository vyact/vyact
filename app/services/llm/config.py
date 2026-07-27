"""
services/llm/config.py — LLM provider 설정 · 상수 · 로깅

provider config 조회, 모델명, 상호작용 로그 저장을 담당한다.
"""
import json
import os

from config.models import (
    DEFAULT_MODEL, LLM_TEMPERATURE, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_MAX_TOKENS, TOP_K, TOP_P,
    OLLAMA_KEEP_ALIVE,
)
from config import INSTALL_DIR, get_log_file
from logger import get_logger

logger = get_logger(__name__)

OLLAMA_URL = os.getenv("OLLAMA_URL", "http://localhost:11434")
IMAGES_DIR = INSTALL_DIR / "uploads" / "images"

# 답변에서 잘라내야 하는 모델 특수 토큰 (스트리밍/재사용 공통)
LLM_STOP_TOKENS = ("<|endoftext|>", "<|im_start|>", "<|im_end|>")

# 도구 호출 판단 루프의 최대 횟수. 제공자별 동작을 동일하게 유지한다.
TOOL_CALL_MAX_ROUNDS = 10

# 상수 재노출 (다른 llm 하위 모듈에서 import해 사용)
__all__ = [
    "OLLAMA_URL", "IMAGES_DIR",
    "DEFAULT_MODEL", "LLM_TEMPERATURE", "LLM_NUM_CTX", "LLM_NUM_PREDICT", "LLM_MAX_TOKENS", "TOP_K", "TOP_P",
    "OLLAMA_KEEP_ALIVE", "LLM_STOP_TOKENS", "TOOL_CALL_MAX_ROUNDS",
    "get_provider_config", "get_model_name", "log_llm_call", "log_tool_names", "log_llm_interaction", "logger",
]


async def get_provider_config() -> dict:
    """현재 Provider 설정 반환 (ES 기반)"""
    try:
        from routers.deps import load_config_async
        config = await load_config_async()
        if config:
            return {
                "type": config.get("type", "ollama"),
                "model": config.get("model", DEFAULT_MODEL),
                "api_key": config.get("api_key"),
            }
    except Exception as e:
        logger.warning("[llm] get_provider_config 실패: %s", e)

    return {"type": "ollama", "model": os.getenv("OLLAMA_MODEL", DEFAULT_MODEL), "api_key": None}


async def get_model_name() -> str:
    return (await get_provider_config())["model"]


def log_llm_call(
        reason: str,
        provider: str,
        model: str,
        streaming: bool,
        *,
        reasoning: bool | None = None,
        is_tool_judgment: bool = False,
        round_no: int | None = None,
        extra: str = "",
) -> None:
    """실제 LLM API 호출 시점에 app 로그(app_*.log)에 한 줄 남긴다."""
    kind = "tool_judgment" if is_tool_judgment else "call"
    round_part = f" round={round_no}" if round_no is not None else ""
    reasoning_part = f" reasoning={reasoning}" if reasoning is not None else ""
    extra_part = f" {extra}" if extra else ""
    logger.info(
        "[llm_call] reason=%s provider=%s model=%s streaming=%s kind=%s%s%s%s",
        reason, provider, model, streaming, kind, round_part, reasoning_part, extra_part,
    )


async def log_tool_names(tool_names: list[str], reason: str = ""):
    """tool_logging=true일 때 LLM에 전달된 tool 이름 목록을 app 로그에 기록."""
    if not tool_names:
        return
    try:
        from routers.deps import load_config_async
        cfg = await load_config_async()
        if not cfg.get("tool_logging", False):
            return
        logger.info("[tool_pass] reason=%s count=%d tools=[%s]", reason, len(tool_names), ", ".join(tool_names))
    except Exception:
        pass


async def log_llm_interaction(log_data: dict):
    """LLM 요청/응답 로그 저장 (llm_YYYYMMDD.log) — config llm_logging=true 시에만"""
    try:
        from routers.deps import load_config_async
        cfg = await load_config_async()

        if not cfg.get("llm_logging", False):
            return
        # thinking 필드 제거 (용량 절감)
        save_data = {k: v for k, v in log_data.items() if k != "origin_response"}
        if isinstance(save_data.get("response"), dict):
            resp = dict(save_data["response"])
            if isinstance(resp.get("message"), dict):
                msg = dict(resp["message"])
                msg.pop("thinking", None)
                resp["message"] = msg
            resp.pop("thinking", None)
            save_data["response"] = resp
        with open(get_log_file("llm"), "a", encoding="utf-8") as f:
            f.write(json.dumps(save_data, ensure_ascii=False) + "\n")
        logger.info("[llm_log] 저장 완료: %s", get_log_file('llm'))

    except Exception as e:
        logger.warning("[경고] 로그 저장 실패: %s", e)
