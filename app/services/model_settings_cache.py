"""Persist immutable installed-model settings metadata; invalidate on file changes."""
import asyncio
import hashlib
import json
import logging
import os
from pathlib import Path

from services.model_profile_defaults import profile_model_info
from services.reasoning_capabilities import get_gguf_reasoning_capabilities, get_mlx_reasoning_capabilities
from services.vyact_runtime import get_model_modalities
from services.vyact_model_metadata_cache import get_cached_model_metadata, save_cached_model_metadata


logger = logging.getLogger(__name__)

def settings_file_signature(path: Path) -> str:
    # Include projector, draft associations and config edits, without reading weights.
    root = path if path.is_dir() else path.parent
    files = sorted(file for file in root.rglob('*') if file.is_file())
    identity = [(str(file.relative_to(root)), file.stat().st_size, file.stat().st_mtime_ns) for file in files]
    return hashlib.sha256(json.dumps(identity).encode()).hexdigest()


def _read_settings_metadata(model_path: str, runtime: str, path: Path) -> dict:
    info = profile_model_info(model_path, runtime)
    return {
        'info': {**info, 'path': str(info['path'])},
        'reasoning': get_mlx_reasoning_capabilities(path) if runtime == 'mlx' else get_gguf_reasoning_capabilities(path),
        'modalities': [] if runtime == 'mlx' else get_model_modalities(path),
    }


async def read_model_settings_metadata(model_path: str, runtime: str, path: Path) -> dict:
    signature = await asyncio.to_thread(settings_file_signature, path)
    revision = f'settings-v1-{runtime}'
    try:
        cached = await get_cached_model_metadata('__installed_settings__', model_path, revision, 0)
    except Exception:
        logger.warning('Settings metadata cache unavailable; reading local model: %s', model_path, exc_info=True)
        cached = None
    if cached and cached.get('file_signature') == signature and 'settings_metadata' in cached:
        result = cached['settings_metadata']
    else:
        result = await asyncio.to_thread(_read_settings_metadata, model_path, runtime, path)
        try:
            await save_cached_model_metadata('__installed_settings__', model_path, revision, 0, {'settings_metadata': result, 'file_signature': signature})
        except Exception:
            logger.warning('Settings metadata cache write failed; using local result: %s', model_path, exc_info=True)
    return {**result, 'info': {**result['info'], 'path': Path(result['info']['path']), 'limits': {**result['info']['limits'], 'cpu_threads_max': os.cpu_count() or 1}}}
