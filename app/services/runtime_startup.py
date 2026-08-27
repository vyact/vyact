"""Startup coordination for optional native runtime updates."""

import asyncio
import json
import os
import platform
from pathlib import Path

from logger import get_logger
from routers.deps import load_config_async, load_ui_language_async, save_config_async
from services.model_runtime_profiles import (
    get_model_profile,
    normalize_model_profile,
    recommended_model_profile,
    save_model_profile,
)
from services.runtime_settings import apply_runtime_settings
from services.vyact_runtime import VYACT_RUNTIME_DIR, get_native_update_commands, get_runtime_paths, start_configured_runtime

logger = get_logger(__name__)

_startup_state: dict = {"status": "not_required", "packages": []}
_action_lock = asyncio.Lock()


def get_startup_runtime_state() -> dict:
    return dict(_startup_state)


def _uses_package_manager_runtime(config: dict) -> bool:
    if config.get("type") != "vyact":
        return False
    vyact_config = config.get("vyact_config", {})
    if vyact_config.get("runtime", "gguf") != "gguf" or not vyact_config.get("model_path"):
        return False
    managed_bin = VYACT_RUNTIME_DIR / "bin"
    paths = get_runtime_paths()
    return bool(
        paths.llama_server and paths.llama_swap
        and managed_bin not in Path(paths.llama_server).parents
        and managed_bin not in Path(paths.llama_swap).parents
    )


async def detect_native_runtime_updates(config: dict) -> dict:
    """Return package updates without modifying an installed runtime."""
    global _startup_state
    if not _uses_package_manager_runtime(config):
        _startup_state = {"status": "not_required", "packages": []}
        return get_startup_runtime_state()

    try:
        if platform.system() in {"Darwin", "Linux"}:
            brew = next((command[0] for command in get_native_update_commands() if command), "")
            if not brew:
                raise RuntimeError("Homebrew is unavailable")
            process = await asyncio.create_subprocess_exec(
                brew, "outdated", "--formula", "--json=v2", "llama.cpp", "llama-swap",
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                env={**os.environ, "HOMEBREW_NO_AUTO_UPDATE": "1"},
            )
            stdout, stderr = await process.communicate()
            if process.returncode != 0:
                raise RuntimeError(stderr.decode("utf-8", errors="replace").strip())
            data = json.loads(stdout.decode("utf-8") or "{}")
            packages = [
                {
                    "name": item.get("name", ""),
                    "installed": ", ".join(item.get("installed_versions") or []),
                    "available": item.get("current_version", ""),
                }
                for item in data.get("formulae", [])
            ]
        else:
            # winget reports available upgrades through the upgrade command itself.
            packages = []
            for command in get_native_update_commands():
                check_command = [*command, "--include-unknown"]
                process = await asyncio.create_subprocess_exec(
                    *check_command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                stdout, _ = await process.communicate()
                output = stdout.decode("utf-8", errors="replace")
                if process.returncode == 0 and "No applicable upgrade found" not in output:
                    packages.append({"name": command[command.index("--id") + 1], "installed": "", "available": ""})
        _startup_state = {"status": "update_available" if packages else "not_required", "packages": packages}
    except Exception as error:
        logger.warning("[runtime_update] update check failed; continuing with current runtime: %s", error)
        _startup_state = {"status": "check_failed", "packages": []}
    return get_startup_runtime_state()


async def load_configured_vyact_model(config: dict | None = None) -> tuple[str, str]:
    """Load the persisted Vyact model and reapply its saved runtime profile."""
    config = config or await load_config_async()
    vyact_config = config.get("vyact_config", {})
    if config.get("type") != "vyact" or not vyact_config.get("model_path"):
        return "", ""
    model_id = await asyncio.to_thread(
        start_configured_runtime, vyact_config, config.get("debug_logging", False),
    )
    config["model"] = model_id
    vyact_config["model"] = model_id
    common_settings = config.get("runtime_settings", {})
    profile = await get_model_profile(vyact_config["model_path"])
    if profile is None:
        profile = await save_model_profile(recommended_model_profile(
            vyact_config["model_path"], vyact_config.get("runtime", "gguf"),
            vyact_config.get("repository"), vyact_config.get("context_size", 32768),
        ))
    elif profile.get("history_token_budget") is None:
        profile = await save_model_profile(normalize_model_profile({
            **profile, "history_token_budget": common_settings.get("history_token_budget", 16384),
        }))
    vyact_config.update({key: profile.get(key) for key in (
        "context_size", "max_output_tokens", "temperature", "top_k", "top_p", "cache_quantization",
        "mtp_enabled", "kv_cache_precision", "performance_mode", "cpu_threads", "seed", "history_token_budget",
    )})
    apply_runtime_settings({
        **common_settings,
        "llm_num_ctx": profile["context_size"],
        "llm_num_predict": profile["max_output_tokens"],
        "llm_max_tokens": profile["max_output_tokens"],
        "llm_temperature": profile["temperature"],
        "top_k": profile.get("top_k"),
        "top_p": profile.get("top_p"),
        "history_token_budget": profile.get("history_token_budget", common_settings.get("history_token_budget", 16384)),
    })
    await save_config_async(config)
    return model_id, await load_ui_language_async() or ""


async def apply_startup_runtime_choice(update: bool) -> tuple[str, str]:
    global _startup_state
    async with _action_lock:
        if _startup_state.get("status") == "ready":
            return "", ""
        if update:
            _startup_state = {**_startup_state, "status": "updating"}
            for command in get_native_update_commands():
                process = await asyncio.create_subprocess_exec(
                    *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                stdout, _ = await process.communicate()
                if process.returncode != 0:
                    detail = stdout.decode("utf-8", errors="replace").strip().splitlines()
                    _startup_state = {**_startup_state, "status": "update_failed"}
                    raise RuntimeError(detail[-1] if detail else "Runtime update failed")
        _startup_state = {**_startup_state, "status": "loading_model"}
        result = await load_configured_vyact_model()
        _startup_state = {"status": "ready", "packages": []}
        return result
