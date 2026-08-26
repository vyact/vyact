"""Exact local-runtime token counting with a conservative fallback."""
from __future__ import annotations

import asyncio
from functools import lru_cache
import json
import os
from urllib.parse import quote

import httpx

from services.mlx_runtime import get_downloaded_mlx_model_path
from config import INSTALL_DIR

from .context_window import estimate_message_tokens


async def count_local_message_tokens(
        messages: list[dict], provider_config: dict, tools: list[dict] | None,
) -> int:
    """Count with the model tokenizer, falling back to the common tokenizer."""
    try:
        if provider_config.get("runtime") == "mlx":
            model_path = provider_config.get("model_path")
            if not model_path:
                raise ValueError("MLX model path is unavailable")
            return await asyncio.to_thread(_count_mlx_tokens, model_path, messages, tools)
        return await _count_llama_tokens(messages, provider_config, tools)
    except (ImportError, OSError, RuntimeError, TypeError, ValueError, httpx.HTTPError, KeyError):
        return count_cloud_message_tokens(messages)


@lru_cache(maxsize=1)
def _cloud_encoding():
    import tiktoken

    tokenizer_cache = INSTALL_DIR / "runtime" / "tokenizers"
    tokenizer_cache.mkdir(parents=True, exist_ok=True)
    os.environ.setdefault("TIKTOKEN_CACHE_DIR", str(tokenizer_cache))
    return tiktoken.get_encoding("o200k_base")


def count_cloud_message_tokens(messages: list[dict]) -> int:
    """Estimate cloud-provider history with the local o200k_base tokenizer."""
    try:
        encoding = _cloud_encoding()
        total = 2
        for message in messages:
            total += 4
            for key in ("role", "name", "content", "tool_calls"):
                value = message.get(key)
                if value:
                    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False)
                    total += len(encoding.encode(text))
        return total
    except Exception:
        return estimate_message_tokens(messages, 2.0)


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
