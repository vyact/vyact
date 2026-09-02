"""Startup coordination for optional native runtime updates."""

import asyncio
import json
import os
import platform
from datetime import datetime, timezone
from pathlib import Path

import httpx

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


def runtime_load_error_code(error: Exception) -> str:
    """Map a concrete runtime load failure to a stable user-facing code."""
    from services.llm.errors import http_error_response_body, is_insufficient_memory_message

    detail = http_error_response_body(error) if isinstance(error, httpx.HTTPStatusError) else str(error)
    return "model_insufficient_memory" if is_insufficient_memory_message(detail) else "model_warmup_failed"


def mark_runtime_load_failed(error: Exception, model_id: str) -> str:
    global _startup_state
    error_code = runtime_load_error_code(error)
    _startup_state = {
        "status": "load_failed", "packages": [], "error_code": error_code, "model": model_id,
    }
    return error_code


def _uses_package_manager_runtime(config: dict) -> bool:
    if config.get("type") != "vyact":
        return False
    vyact_config = config.get("vyact_config", {})
    if not vyact_config.get("model_path"):
        return False
    if vyact_config.get("runtime", "gguf") == "mlx":
        from services.mlx_runtime import is_apple_silicon
        return is_apple_silicon()
    managed_bin = VYACT_RUNTIME_DIR / "bin"
    paths = get_runtime_paths()
    return bool(
        paths.llama_server and paths.llama_swap
        and managed_bin not in Path(paths.llama_server).parents
        and managed_bin not in Path(paths.llama_swap).parents
    )


def get_runtime_update_commands(config: dict) -> list[list[str]]:
    if config.get("vyact_config", {}).get("runtime", "gguf") == "mlx":
        from services.mlx_runtime import get_omlx_update_commands
        return get_omlx_update_commands()
    return get_native_update_commands()


async def warm_loaded_vyact_model(
        model_id: str, language: str | None = None, runtime: str | None = None,
) -> bool:
    """Require model compilation, then best-effort warm the stable chat prefix."""
    if not model_id:
        return False
    try:
        from services.llm.warmup import warm_vyact_model_compile

        if runtime is None:
            config = await load_config_async()
            runtime = config.get("vyact_config", {}).get("runtime", "gguf")

        await warm_vyact_model_compile(model_id, raise_on_error=True)
    except Exception as error:
        logger.warning("[llm_warmup] model_compile failed before prefix cache: %s", error)
        raise

    try:
        from prompts import FORMAT_INSTRUCTION
        from routers.chat_helpers import load_system_prompt
        from services.conv_summary import build_summary_instruction
        from services.llm.warmup import warm_vyact_chat_prefix

        _, _, selected_system_prompt = await load_system_prompt("")
        general_chat_system_prompt = (
            selected_system_prompt or FORMAT_INSTRUCTION
        ) + build_summary_instruction("", False)
        await warm_vyact_chat_prefix(
            model_id,
            language if language is not None else await load_ui_language_async() or "",
            general_chat_system_prompt,
            runtime=runtime,
            raise_on_error=False,
        )
    except Exception as error:
        logger.warning("[llm_warmup] prefix_cache preparation failed (model=%s): %s", model_id, error)
    return True


async def detect_native_runtime_updates(config: dict) -> dict:
    """Return package updates without modifying an installed runtime."""
    global _startup_state
    if not _uses_package_manager_runtime(config):
        _startup_state = {"status": "not_required", "packages": []}
        return get_startup_runtime_state()

    if config.get("vyact_config", {}).get("runtime") == "mlx":
        from services.omlx_policy import refresh_external_mtp_capabilities
        await asyncio.to_thread(refresh_external_mtp_capabilities)

    try:
        if platform.system() in {"Darwin", "Linux"}:
            commands = get_runtime_update_commands(config)
            brew = next((command[0] for command in commands if command), "")
            if not brew:
                raise RuntimeError("Homebrew is unavailable")
            formulae = ["omlx"] if config.get("vyact_config", {}).get("runtime") == "mlx" else ["llama.cpp", "llama-swap"]
            process = await asyncio.create_subprocess_exec(
                brew, "outdated", "--formula", "--json=v2", *formulae,
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
            for command in get_runtime_update_commands(config):
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
    common_settings = config.get("runtime_settings", {})
    profile = await get_model_profile(vyact_config["model_path"])
    if profile is None:
        profile = await save_model_profile(recommended_model_profile(
            vyact_config["model_path"], vyact_config.get("runtime", "gguf"),
            vyact_config.get("repository"), vyact_config.get("context_size", 32768),
        ))
    else:
        migrated_profile = normalize_model_profile({
            **profile,
            "history_token_budget": profile.get(
                "history_token_budget", common_settings.get("history_token_budget", 16384),
            ),
        })
        if any(profile.get(key) != value for key, value in migrated_profile.items()):
            profile = await save_model_profile(migrated_profile)
    vyact_config.update({key: profile.get(key) for key in (
        "context_size", "max_output_tokens", "temperature", "top_k", "top_p", "cache_quantization",
        "mtp_enabled", "kv_cache_precision", "performance_mode", "cpu_threads", "seed", "history_token_budget",
        "gpu_split_percentages",
        "gpu_manual_split_enabled",
    )})
    runtime_status: dict = {}
    model_id = await asyncio.to_thread(
        start_configured_runtime, vyact_config, config.get("debug_logging", False), runtime_status,
    )
    if runtime_status.get("mtp_fallback"):
        profile = await save_model_profile({
            **profile,
            "mtp_enabled": False,
            "mtp_failure_code": runtime_status.get("mtp_failure_code", "load_failed"),
            "mtp_failure_message": runtime_status.get("mtp_failure_message"),
            "mtp_failed_at": datetime.now(timezone.utc).isoformat(),
        })
        vyact_config.update({
            "mtp_enabled": False,
            "mtp_failure_code": profile["mtp_failure_code"],
            "mtp_failure_message": profile["mtp_failure_message"],
            "mtp_failed_at": profile["mtp_failed_at"],
        })
    config["model"] = model_id
    vyact_config["model"] = model_id
    apply_runtime_settings({
        **common_settings,
        "llm_num_ctx": profile["context_size"],
        "llm_num_predict": profile["max_output_tokens"],
        "llm_max_tokens": profile["max_output_tokens"],
        "llm_temperature": profile["temperature"],
        "top_k": profile.get("top_k"),
        "top_p": profile.get("top_p"),
        "seed": profile.get("seed"),
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
            config = await load_config_async()
            for command in get_runtime_update_commands(config):
                process = await asyncio.create_subprocess_exec(
                    *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                )
                stdout, _ = await process.communicate()
                if process.returncode != 0:
                    detail = stdout.decode("utf-8", errors="replace").strip().splitlines()
                    _startup_state = {**_startup_state, "status": "update_failed"}
                    raise RuntimeError(detail[-1] if detail else "Runtime update failed")
            if config.get("vyact_config", {}).get("runtime") == "mlx":
                from services.omlx_policy import refresh_external_mtp_capabilities
                await asyncio.to_thread(refresh_external_mtp_capabilities, True)
        _startup_state = {**_startup_state, "status": "loading_model"}
        result = await load_configured_vyact_model()
        try:
            await warm_loaded_vyact_model(*result)
        except Exception as error:
            error_code = mark_runtime_load_failed(error, result[0])
            raise RuntimeError(error_code) from error
        _startup_state = {"status": "ready", "packages": []}
        return result
