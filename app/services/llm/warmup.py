"""Vyact local runtime chat prefix warm-up utilities."""

import time

import httpx

from prompts import build_system_message
from services.mcp_client import mcp_manager
from services.runtime_settings import get_runtime_settings
from services.user_profile import get_profile_text
from services.vyact_runtime import VYACT_RUNTIME_URL

from .config import logger
from .tools import build_tool_directive


async def warm_vyact_model_compile(
        model: str, raise_on_error: bool = False,
) -> bool:
    """Run a minimal generation to load and compile the selected model."""
    started_at = time.perf_counter()
    logger.info("[llm_warmup] model_compile started (model=%s)", model)
    try:
        payload = {
            "model": model,
            "stream": False,
            "max_tokens": 1,
            "temperature": 0,
            "specprefill": False,
            "messages": [{"role": "user", "content": "."}],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{VYACT_RUNTIME_URL}/chat/completions", json=payload)
            response.raise_for_status()
        logger.info(
            "[llm_warmup] model_compile succeeded (model=%s, duration_ms=%d)",
            model, round((time.perf_counter() - started_at) * 1000),
        )
        return True
    except Exception as error:
        logger.warning(
            "[llm_warmup] model_compile failed (model=%s, duration_ms=%d): %s",
            model, round((time.perf_counter() - started_at) * 1000), error,
        )
        if raise_on_error:
            raise
        return False


async def warm_vyact_chat_prefix(
        model: str, language: str, system_prompt: str, runtime: str = "gguf",
        raise_on_error: bool = False,
) -> bool:
    """Prime the OpenAI-compatible local runtime with Vyact's stable system prefix."""
    started_at = time.perf_counter()
    logger.info(
        "[llm_warmup] prefix_cache started (model=%s, runtime=%s, language=%s)",
        model, runtime, language or "default",
    )
    try:
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
            "specprefill": False,
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": "."},
            ],
        }
        if runtime == "gguf":
            payload["cache_prompt"] = True
        if tools:
            payload["tools"] = tools
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{VYACT_RUNTIME_URL}/chat/completions", json=payload)
            response.raise_for_status()
        logger.info(
            "[llm_warmup] prefix_cache succeeded (model=%s, runtime=%s, language=%s, duration_ms=%d)",
            model, runtime, language or "default", round((time.perf_counter() - started_at) * 1000),
        )
        return True
    except Exception as error:
        logger.warning(
            "[llm_warmup] prefix_cache failed (model=%s, runtime=%s, language=%s, duration_ms=%d): %s",
            model, runtime, language or "default", round((time.perf_counter() - started_at) * 1000), error,
        )
        if raise_on_error:
            raise
        return False


async def warm_vyact_voice_prefix(model: str, language: str, system_prompt: str) -> bool:
    """Prime the local runtime with the same system prefix used by voice chat."""
    try:
        system_message = build_system_message(
            system_prompt=system_prompt,
            format_instruction_override="",
            user_language=language,
        )
        payload = {
            "model": model,
            "stream": False,
            "max_tokens": 1,
            "cache_prompt": True,
            "specprefill": False,
            "temperature": get_runtime_settings()["llm_temperature"],
            "messages": [
                {"role": "system", "content": system_message},
                {"role": "user", "content": "."},
            ],
        }
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(f"{VYACT_RUNTIME_URL}/chat/completions", json=payload)
            response.raise_for_status()
        logger.info("[llm_warmup] Vyact voice prefix warmed (model=%s, language=%s)", model, language or "default")
        return True
    except Exception as error:
        logger.debug("[llm_warmup] Vyact voice warm-up skipped: %s", error)
        return False
