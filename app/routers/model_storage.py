"""Model storage relocation jobs survive a closed modal or disconnected client."""
import asyncio
import json
import urllib.error
import urllib.request
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from config import SETUP_DONE
from logger import get_logger
from routers.deps import load_config_async, save_config_async
from services import model_benchmark, model_storage
from services.runtime_startup import get_startup_runtime_state, warm_loaded_vyact_model
from services.vyact_runtime import (
    VYACT_RUNTIME_URL, initialize_downloaded_models_cache,
    start_configured_runtime, stop_all_vyact_runtimes,
)

router = APIRouter()
logger = get_logger(__name__)
_move_task: asyncio.Task | None = None


class StorageRequest(BaseModel):
    path: str


def _runtime_available() -> bool:
    try:
        with urllib.request.urlopen(f"{VYACT_RUNTIME_URL}/models", timeout=2) as response:
            return bool(json.load(response).get("data"))
    except (OSError, ValueError, urllib.error.URLError):
        return False


def _progress(**values) -> None:
    model_storage.move_status = {**model_storage.move_status, **values}


async def _restore(config: dict) -> None:
    vyact_config = config["vyact_config"]
    model_id = await asyncio.to_thread(start_configured_runtime, vyact_config, config.get("debug_logging", False))
    vyact_config["model"] = model_id
    if config.get("type") == "vyact":
        config["model"] = model_id
    await save_config_async(config)
    await warm_loaded_vyact_model(model_id, runtime=vyact_config.get("runtime", "gguf"))


async def _move(plan: dict) -> None:
    config = None
    restore = False
    committed = False
    created = []
    try:
        config = await load_config_async() if SETUP_DONE.exists() else None
        restore = bool(config and config.get("vyact_config", {}).get("model_path") and await asyncio.to_thread(_runtime_available))
        if plan.get("file_count", 1):
            _progress(phase="stopping")
            await asyncio.to_thread(stop_all_vyact_runtimes)
        else:
            restore = False
        created = await asyncio.to_thread(model_storage.copy_models, plan, _progress)
        _progress(phase="switching")
        await asyncio.to_thread(model_storage.save_models_dir, Path(plan["destination"]))
        committed = True
        await asyncio.to_thread(initialize_downloaded_models_cache, force=True)
        _progress(phase="cleaning")
        clean = await asyncio.to_thread(model_storage.clean_source, plan, created)
        if not clean:
            _progress(warning="storage_cleanup")
        if restore:
            _progress(phase="reloading")
            try:
                await _restore(config)
            except Exception:
                logger.exception("Model storage moved but runtime reload failed")
                _progress(warning="storage_reload")
        _progress(phase="complete", copied_bytes=plan["total_bytes"])
    except Exception as error:
        logger.exception("Model storage relocation failed")
        if not committed:
            await asyncio.to_thread(model_storage.remove_copies, created)
            if restore:
                try:
                    await _restore(config)
                except Exception:
                    logger.exception("Could not restore original model runtime")
        code = str(error) if isinstance(error, ValueError) else "storage_failed"
        _progress(phase="error", error=code)
    finally:
        model_storage.active_move = False


@router.get("/vyact/model-storage")
async def storage_status():
    current = model_storage.get_configured_models_dir()
    default_directory = model_storage.INSTALL_DIR.resolve()
    default_path = default_directory / model_storage.DEFAULT_MODELS_DIRECTORY_NAME
    return {
        **model_storage.move_status, "path": str(current), "busy": model_storage.active_move,
        "is_default": current.resolve() == default_path.resolve(),
        "default_directory": str(default_directory),
        "parent_directory": str(current.parent),
    }


def _plan(path: str) -> dict:
    try:
        return model_storage.plan_move(path)
    except (OSError, ValueError) as error:
        code = str(error) if isinstance(error, ValueError) else "invalid_storage_path"
        raise HTTPException(400, code) from error


@router.post("/vyact/model-storage/plan")
async def storage_plan(req: StorageRequest):
    if model_storage.active_move:
        raise HTTPException(409, "storage_busy")
    return await asyncio.to_thread(_plan, req.path)


@router.post("/vyact/model-storage/move")
async def storage_move(req: StorageRequest):
    global _move_task
    with model_storage.operation_lock:
        if (model_storage.active_move or model_storage.active_downloads or model_benchmark.active_job is not None
                or model_benchmark.active_requests or get_startup_runtime_state().get("status") in {"updating", "loading_model"}):
            raise HTTPException(409, "storage_busy")
        # Reserve before the first await so a download cannot start during preflight.
        model_storage.active_move = True
    try:
        plan = await asyncio.to_thread(_plan, req.path)
        if plan["same"]:
            model_storage.active_move = False
            return {"same": True}
        model_storage.move_status = {**plan, "phase": "preparing", "copied_bytes": 0}
        _move_task = asyncio.create_task(_move(plan))
        return {"same": False}
    except BaseException:
        model_storage.active_move = False
        raise
