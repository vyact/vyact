"""
services/llm/config.py — LLM provider 설정 · 상수 · 로깅

provider config 조회, 모델명, 상호작용 로그 저장을 담당한다.
"""
import json
from config.models import (
    DEFAULT_MODEL, LLM_TEMPERATURE, LLM_NUM_CTX, LLM_NUM_PREDICT, LLM_MAX_TOKENS, TOP_K, TOP_P,
)
from config import INSTALL_DIR, get_log_file
from logger import get_logger

logger = get_logger(__name__)

IMAGES_DIR = INSTALL_DIR / "uploads" / "images"
AUDIO_DIR = INSTALL_DIR / "uploads" / "audio"

# 답변에서 잘라내야 하는 모델 특수 토큰 (스트리밍/재사용 공통)
LLM_STOP_TOKENS = ("<|endoftext|>", "<|im_start|>", "<|im_end|>")

# 로컬은 실행 시간과 context 부담을 제한하고, 클라우드는 대규모 코드 작업을
# 충분히 이어갈 수 있도록 별도 도구 호출 라운드 한도를 사용한다.
LOCAL_TOOL_CALL_MAX_ROUNDS = 30
CLOUD_TOOL_CALL_MAX_ROUNDS = 100
TOOL_CALL_MAX_CONSECUTIVE_FAILURES = 3
TOOL_CALL_DECISION_NUM_PREDICT = 2048
TOOL_CALL_MUTATION_NUM_PREDICT = 8192
TOOL_CALL_ROUND_TIMEOUT_SECONDS = 300
TOOL_CALL_RETRY_RESULT_CHARS = 8000

# 상수 재노출 (다른 llm 하위 모듈에서 import해 사용)
__all__ = [
    "AUDIO_DIR", "IMAGES_DIR",
    "DEFAULT_MODEL", "LLM_TEMPERATURE", "LLM_NUM_CTX", "LLM_NUM_PREDICT", "LLM_MAX_TOKENS", "TOP_K", "TOP_P",
    "LLM_STOP_TOKENS", "LOCAL_TOOL_CALL_MAX_ROUNDS", "CLOUD_TOOL_CALL_MAX_ROUNDS",
    "TOOL_CALL_MAX_CONSECUTIVE_FAILURES",
    "TOOL_CALL_DECISION_NUM_PREDICT", "TOOL_CALL_MUTATION_NUM_PREDICT",
    "TOOL_CALL_ROUND_TIMEOUT_SECONDS", "TOOL_CALL_RETRY_RESULT_CHARS",
    "get_provider_config", "get_model_name", "get_model_display_name", "build_provider_headers",
    "log_llm_call", "log_tool_names", "log_llm_interaction", "logger",
]


def build_provider_headers(provider_config: dict) -> dict[str, str]:
    headers: dict[str, str] = {}
    api_key = provider_config.get("api_key")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    for header in provider_config.get("headers") or []:
        name = str(header.get("name", "")).strip()
        value = str(header.get("value", "")).strip()
        if name and value:
            for existing_name in list(headers):
                if existing_name.lower() == name.lower():
                    headers.pop(existing_name)
            headers[name] = value
    return headers


async def get_provider_config() -> dict:
    """현재 Provider 설정 반환 (ES 기반)"""
    try:
        from routers.deps import load_config_async
        config = await load_config_async()
        if config:
            selected_type = config.get("type", "vyact")
            if selected_type == "vyact":
                from services.vyact_runtime import VYACT_RUNTIME_URL
                provider_config = config.get("vyact_config", {})
                return {
                    # llama-swap fronts llama.cpp with an OpenAI-compatible API.
                    # Reusing this path preserves existing streaming and tool calls.
                    "type": "openai",
                    "selection_type": "vyact",
                    "connection_name": "Vyact",
                    "model": config.get("model", provider_config.get("model", DEFAULT_MODEL)),
                    "runtime": provider_config.get("runtime", "gguf"),
                    "model_path": provider_config.get("model_path", ""),
                    "context_size": provider_config.get("context_size", 32768),
                    "mtp_enabled": provider_config.get("mtp_enabled"),
                    "is_local": True,
                    "api_key": None,
                    "base_url": provider_config.get("base_url", VYACT_RUNTIME_URL),
                    "headers": [],
                }
            if selected_type.startswith("custom:"):
                connection_id = selected_type.removeprefix("custom:")
                connection = next(
                    (item for item in config.get("custom_providers", []) if item.get("id") == connection_id),
                    None,
                )
                if connection:
                    return {
                        "type": "openai",
                        "selection_type": selected_type,
                        "connection_name": connection.get("name", selected_type),
                        "model": connection.get("model", DEFAULT_MODEL),
                        "api_key": connection.get("api_key"),
                        "base_url": connection.get("base_url"),
                        "headers": connection.get("headers", []),
                    }
            provider_config = config.get(f"{selected_type}_config", {})
            return {
                "type": selected_type,
                "selection_type": selected_type,
                "model": config.get("model", DEFAULT_MODEL),
                "api_key": provider_config.get("api_key") or config.get("api_key"),
                "base_url": None,
                "history_token_budget": provider_config.get("history_token_budget", 16384),
                "temperature": provider_config.get("temperature", 0.2),
                "max_output_tokens": provider_config.get("max_output_tokens", 2048),
            }
    except Exception as e:
        logger.warning("[llm] get_provider_config 실패: %s", e)

    from services.vyact_runtime import VYACT_RUNTIME_URL
    return {
        "type": "openai", "selection_type": "vyact", "connection_name": "Vyact",
        "model": "", "api_key": None, "base_url": VYACT_RUNTIME_URL,
        "headers": [], "runtime": "gguf", "is_local": True,
    }


async def get_model_name() -> str:
    return (await get_provider_config())["model"]


async def get_model_display_name() -> str:
    """Return the user-facing model name without exposing runtime routing IDs."""
    provider = await get_provider_config()
    if provider.get("selection_type") != "vyact":
        return provider["model"]
    try:
        from routers.deps import load_config_async

        config = await load_config_async()
        model_path = config.get("vyact_config", {}).get("model_path", "")
        if config.get("vyact_config", {}).get("runtime") == "mlx":
            repository = config.get("vyact_config", {}).get("repository") or model_path.removeprefix("mlx/")
            return repository.rstrip("/").split("/")[-1] if repository else provider["model"].rstrip("/").split("/")[-1]
        path_parts = model_path.split("/")
        return "/".join(path_parts[:2]) if len(path_parts) >= 2 else model_path or provider["model"]
    except Exception:
        return provider["model"]


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
