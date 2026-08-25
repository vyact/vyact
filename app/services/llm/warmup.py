"""Vyact local runtime chat prefix warm-up utilities."""

import httpx

from prompts import build_system_message
from services.mcp_client import mcp_manager
from services.runtime_settings import get_runtime_settings
from services.user_profile import get_profile_text

from .config import logger
from .tools import build_tool_directive


async def warm_vyact_chat_prefix(model: str, language: str, system_prompt: str) -> bool:
    """Prime the OpenAI-compatible local runtime with Vyact's stable system prefix."""
    try:
        from services.vyact_runtime import VYACT_RUNTIME_URL
        user_profile = await get_profile_text()
        system_message = build_system_message(
            system_prompt=system_prompt, format_instruction_override=None, user_profile=user_profile,
            user_language=language,
        )
        tools = await mcp_manager.get_tools()
        if tools:
            tool_names = [tool["function"]["name"] for tool in tools]
            system_message += await build_tool_directive(tool_names)
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
        if tools:
            payload["tools"] = tools
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{VYACT_RUNTIME_URL}/chat/completions", json=payload)
            response.raise_for_status()
        logger.info("[llm_warmup] Vyact chat prefix warmed (model=%s, language=%s)", model, language or "default")
        return True
    except Exception as error:
        logger.debug("[llm_warmup] Vyact skipped: %s", error)
        return False
