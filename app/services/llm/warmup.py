"""Local Ollama chat prefix warm-up utilities."""
import asyncio

import httpx

from prompts import build_system_message
from config.models import LLM_INITIAL_NUM_CTX
from services.runtime_settings import get_runtime_settings

from .config import OLLAMA_URL, logger

_warmup_keys: set[str] = set()
_warmup_tasks: set[asyncio.Task] = set()


async def warm_ollama_chat_prefix(model: str, language: str) -> bool:
    """Evaluate the default system prompt once so Ollama can retain its prefix cache."""
    try:
        runtime = get_runtime_settings()
        system_message = build_system_message(
            system_prompt="",
            format_instruction_override=None,
            user_language=language,
        )
        payload = {
            "model": model,
            "stream": False,
            "keep_alive": runtime["ollama_keep_alive"],
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": ""},
            ],
            "options": {
                "num_ctx": LLM_INITIAL_NUM_CTX,
                "num_predict": 0,
                "temperature": runtime["llm_temperature"],
                **({"top_k": runtime["top_k"]} if runtime["top_k"] else {}),
                **({"top_p": runtime["top_p"]} if runtime["top_p"] else {}),
            },
            "think": False,
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{OLLAMA_URL}/api/chat", json=payload)
            response.raise_for_status()
        logger.info("[llm_warmup] Ollama chat prefix warmed (model=%s, language=%s)", model, language or "default")
        return True
    except Exception as e:
        logger.debug("[llm_warmup] skipped: %s", e)
        return False


def schedule_ollama_prefix_warmup(model: str, language: str) -> bool:
    """Start a non-blocking one-time warm-up for a model and UI language."""
    warmup_key = f"{model}:{language}"
    if warmup_key in _warmup_keys:
        return False

    _warmup_keys.add(warmup_key)
    task = asyncio.create_task(warm_ollama_chat_prefix(model, language))
    _warmup_tasks.add(task)
    def complete(completed_task: asyncio.Task) -> None:
        _warmup_tasks.discard(completed_task)
        if completed_task.cancelled() or not completed_task.result():
            _warmup_keys.discard(warmup_key)
    task.add_done_callback(complete)
    return True
