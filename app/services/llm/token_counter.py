"""Exact local-runtime token counting with a conservative fallback."""
from __future__ import annotations

import asyncio
from functools import lru_cache
from urllib.parse import quote

import httpx

from services.mlx_runtime import get_downloaded_mlx_model_path

from .context_window import estimate_message_tokens


async def count_local_message_tokens(
        messages: list[dict], provider_config: dict, tools: list[dict] | None,
        chars_per_token: float,
) -> int:
    """Count the fully templated request with the selected model tokenizer."""
    try:
        if provider_config.get("runtime") == "mlx":
            model_path = provider_config.get("model_path")
            if not model_path:
                raise ValueError("MLX model path is unavailable")
            return await asyncio.to_thread(_count_mlx_tokens, model_path, messages, tools)
        return await _count_llama_tokens(messages, provider_config, tools)
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, httpx.HTTPError, KeyError):
        return estimate_message_tokens(messages, chars_per_token)


async def _count_llama_tokens(
        messages: list[dict], provider_config: dict, tools: list[dict] | None,
) -> int:
    base_url = str(provider_config.get("base_url") or "").rstrip("/")
    native_base_url = base_url[:-3] if base_url.endswith("/v1") else base_url
    model = str(provider_config.get("model") or "")
    if provider_config.get("selection_type") == "vyact":
        native_base_url = f"{native_base_url}/upstream/{quote(model, safe='')}"
    template_body: dict = {"model": model, "messages": messages}
    if tools:
        template_body["tools"] = tools
    async with httpx.AsyncClient(timeout=10.0) as client:
        template_response = await client.post(f"{native_base_url}/apply-template", json=template_body)
        template_response.raise_for_status()
        prompt = template_response.json()["prompt"]
        token_response = await client.post(
            f"{native_base_url}/tokenize", json={"model": model, "content": prompt, "add_special": False},
        )
        token_response.raise_for_status()
    return len(token_response.json()["tokens"])


@lru_cache(maxsize=2)
def _load_mlx_tokenizer(model_path: str):
    from mlx_lm.tokenizer_utils import load_tokenizer

    downloaded_path = get_downloaded_mlx_model_path(model_path)
    return load_tokenizer(downloaded_path)


def _count_mlx_tokens(
        model_path: str, messages: list[dict], tools: list[dict] | None,
) -> int:
    tokenizer = _load_mlx_tokenizer(model_path)
    template_kwargs = {"tokenize": True, "add_generation_prompt": True}
    if tools:
        template_kwargs["tools"] = [tool["function"] for tool in tools]
    tokens = tokenizer.apply_chat_template(messages, **template_kwargs)
    return len(tokens)
