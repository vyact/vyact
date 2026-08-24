"""Vyact local runtime chat prefix warm-up utilities."""

import httpx

from prompts import build_system_message
from services.runtime_settings import get_runtime_settings

from .config import logger


async def warm_vyact_chat_prefix(model: str, language: str) -> bool:
    """Prime the OpenAI-compatible local runtime with Vyact's stable system prefix."""
    try:
        from services.vyact_runtime import VYACT_RUNTIME_URL
        system_message = build_system_message(
            system_prompt="", format_instruction_override=None, user_language=language,
        )
        payload = {
            "model": model,
            "stream": False,
            "max_tokens": 1,
            "temperature": get_runtime_settings()["llm_temperature"],
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": "."},
            ],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{VYACT_RUNTIME_URL}/chat/completions", json=payload)
            response.raise_for_status()
        logger.info("[llm_warmup] Vyact chat prefix warmed (model=%s, language=%s)", model, language or "default")
        return True
    except Exception as error:
        logger.debug("[llm_warmup] Vyact skipped: %s", error)
        return False
