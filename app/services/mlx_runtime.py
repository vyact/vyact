"""Managed Apple Silicon MLX-VLM model downloads and OpenAI-compatible runtime."""
import asyncio
import json
import os
import platform
import shutil
import signal
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from functools import lru_cache
from pathlib import Path
from typing import Callable

from tqdm.auto import tqdm

from config import INSTALL_DIR, get_log_file
from services.vyact_runtime import VYACT_RUNTIME_PORT

MLX_MODELS_DIR = INSTALL_DIR / "models" / "mlx"
MLX_RUNTIME_DIR = INSTALL_DIR / "runtime"
MLX_RUNTIME_PID_FILE = MLX_RUNTIME_DIR / "mlx-vlm.pid"
OMLX_RUNTIME_PID_FILE = MLX_RUNTIME_DIR / "omlx.pid"
OMLX_BASE_DIR = MLX_RUNTIME_DIR / "omlx"
MLX_MODEL_MANIFEST = ".vyact-mlx-model.json"
_HF_ONLINE_DOWNLOAD_LOCK = threading.Lock()
_MLX_RUNTIME_GRACEFUL_STOP_SECONDS = 30
_MLX_RUNTIME_FORCE_STOP_SECONDS = 5
_MLX_APC_NUM_BLOCKS = 2048
_MLX_APC_EXACT_CACHE_ENTRIES = 4
_MLX_APC_DEFAULT_TENANT = "vyact"
_MLX_APC_DISK_DIR = MLX_RUNTIME_DIR / "prompt-cache"
_MLX_APC_DISK_MAX_GB = 2
_MLX_KV_QUANTIZATION_MIN_CONTEXT = 32768
_mlx_runtime_process: subprocess.Popen | None = None
_active_dflash2_model: str | None = None


@contextmanager
def _hugging_face_online_download():
    """Temporarily allow an explicit model download in an offline-by-default app."""
    import huggingface_hub.constants as hub_constants
    from huggingface_hub.utils import _http

    with _HF_ONLINE_DOWNLOAD_LOCK:
        previous_environment = os.environ.get("HF_HUB_OFFLINE")
        previous_constant = hub_constants.HF_HUB_OFFLINE
        os.environ["HF_HUB_OFFLINE"] = "0"
        hub_constants.HF_HUB_OFFLINE = False
        _http.close_session()
        try:
            yield
        finally:
            if previous_environment is None:
                os.environ.pop("HF_HUB_OFFLINE", None)
            else:
                os.environ["HF_HUB_OFFLINE"] = previous_environment
            hub_constants.HF_HUB_OFFLINE = previous_constant
            _http.close_session()


def is_apple_silicon() -> bool:
    return platform.system() == "Darwin" and platform.machine().lower() in {"arm64", "aarch64"}


async def install_missing_omlx_runtime():
    if not is_apple_silicon():
        raise RuntimeError("oMLX requires Apple Silicon")
    if shutil.which("omlx"):
        yield "Existing oMLX installation detected"
        return
    brew = shutil.which("brew")
    if not brew:
        from services.vyact_runtime import RuntimePackageManagerMissingError
        raise RuntimePackageManagerMissingError("Homebrew is required to install oMLX")
    for command in get_omlx_install_commands(brew):
        process = await asyncio.create_subprocess_exec(
            *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
        )
        assert process.stdout is not None
        async for raw in process.stdout:
            yield raw.decode(errors="replace").rstrip()
        if await process.wait() != 0:
            raise RuntimeError(f"oMLX installation failed: {' '.join(command)}")


def get_omlx_install_commands(brew: str) -> list[list[str]]:
    return [
        [brew, "tap", "jundot/omlx", "https://github.com/jundot/omlx"],
        [brew, "trust", "--formula", "jundot/omlx/omlx"],
        [brew, "install", "omlx"],
    ]


def _repository_path(repository: str) -> Path:
    parts = repository.split("/")
    if len(parts) != 2 or not all(parts) or any(part in {".", ".."} for part in parts):
        raise ValueError("Invalid Hugging Face repository ID")
    return MLX_MODELS_DIR.joinpath(*parts)


def list_downloaded_mlx_models() -> list[str]:
    if not MLX_MODELS_DIR.is_dir():
        return []
    return sorted(
        f"mlx/{path.parent.relative_to(MLX_MODELS_DIR).as_posix()}"
        for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST)
        if path.is_file() and _read_model_manifest(path).get("role", "model") == "model"
    )


def list_mtp_supported_mlx_models() -> list[str]:
    if not MLX_MODELS_DIR.is_dir():
        return []
    models = []
    for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST):
        if not path.is_file():
            continue
        manifest = _read_model_manifest(path)
        mtp_repository = manifest.get("mtp_repository")
        if manifest.get("role", "model") != "model" or not isinstance(mtp_repository, str):
            continue
        try:
            mtp_path = _repository_path(mtp_repository)
        except ValueError:
            continue
        if (mtp_path / MLX_MODEL_MANIFEST).is_file():
            models.append(f"mlx/{path.parent.relative_to(MLX_MODELS_DIR).as_posix()}")
    return sorted(models)


def list_dflash2_supported_mlx_models() -> list[str]:
    models = set(_list_companion_supported_mlx_models("dflash2_repository"))
    for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST) if MLX_MODELS_DIR.is_dir() else []:
        manifest = _read_model_manifest(path)
        if manifest.get("role", "model") == "model" and manifest.get("dflash2_subdirectory") == "dflash":
            if _is_complete_mlx_model(path.parent / "dflash"):
                models.add(f"mlx/{path.parent.relative_to(MLX_MODELS_DIR).as_posix()}")
    return sorted(models)


def get_active_dflash2_mlx_model() -> str | None:
    return _active_dflash2_model


def _list_companion_supported_mlx_models(manifest_key: str) -> list[str]:
    models = []
    if not MLX_MODELS_DIR.is_dir():
        return models
    for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST):
        if not path.is_file():
            continue
        manifest = _read_model_manifest(path)
        repository = manifest.get(manifest_key)
        if manifest.get("role", "model") != "model" or not isinstance(repository, str):
            continue
        try:
            companion_path = _repository_path(repository)
        except ValueError:
            continue
        if (companion_path / MLX_MODEL_MANIFEST).is_file():
            models.append(f"mlx/{path.parent.relative_to(MLX_MODELS_DIR).as_posix()}")
    return sorted(models)


def _read_model_manifest(path: Path) -> dict:
    try:
        value = json.loads(path.read_text(encoding="utf-8"))
        return value if isinstance(value, dict) else {}
    except (OSError, json.JSONDecodeError):
        return {}


def download_mlx_model(
    repository: str,
    revision: str,
    token: str | None = None,
    progress_callback: Callable[[int], None] | None = None,
    role: str = "model",
) -> Path:
    if not is_apple_silicon():
        raise RuntimeError("MLX models require Apple Silicon")
    from huggingface_hub import snapshot_download
    from services.huggingface_models import MLX_DOWNLOAD_PATTERNS

    destination = _repository_path(repository)
    destination.mkdir(parents=True, exist_ok=True)

    class MlxDownloadProgress(tqdm):
        """Forward byte deltas from concurrent Hub file downloads."""

        _callback_lock = threading.Lock()

        def __init__(self, *args, **kwargs):
            description = str(kwargs.get("desc") or "")
            # hf_xet emits both network-transfer and local-reconstruction byte
            # bars for the same file. Counting both doubles reported progress.
            self._tracks_bytes = (
                kwargs.get("unit") == "B"
                and not description.endswith(": reconstructing file")
            )
            super().__init__(*args, **kwargs)

        def update(self, n=1):
            displayed = super().update(n)
            if self._tracks_bytes and progress_callback and n > 0:
                with self._callback_lock:
                    progress_callback(int(n))
            return displayed

    with _hugging_face_online_download():
        snapshot_download(
            repo_id=repository,
            revision=revision,
            token=token,
            local_dir=str(destination),
            allow_patterns=list(MLX_DOWNLOAD_PATTERNS),
            tqdm_class=MlxDownloadProgress,
        )
    if not (destination / "config.json").is_file() or not any(destination.rglob("*.safetensors")):
        raise RuntimeError("The downloaded repository is not a complete MLX model")
    (destination / MLX_MODEL_MANIFEST).write_text(json.dumps({
        "repository": repository,
        "revision": revision,
        "role": role,
    }), encoding="utf-8")
    return destination


def associate_mlx_mtp_model(model_path: Path, mtp_repository: str, mtp_path: Path) -> None:
    manifest_path = model_path / MLX_MODEL_MANIFEST
    manifest = _read_model_manifest(manifest_path)
    if not manifest:
        raise RuntimeError("The downloaded MLX model manifest is missing")
    if mtp_path != _repository_path(mtp_repository):
        raise ValueError("The MTP model path does not match its repository")
    manifest["mtp_repository"] = mtp_repository
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def associate_mlx_dflash2_model(model_path: Path, repository: str, companion_path: Path) -> None:
    manifest_path = model_path / MLX_MODEL_MANIFEST
    manifest = _read_model_manifest(manifest_path)
    if not manifest:
        raise RuntimeError("The downloaded MLX model manifest is missing")
    if companion_path != _repository_path(repository):
        raise ValueError("The DFlash2 model path does not match its repository")
    manifest["dflash2_repository"] = repository
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def associate_mlx_bundled_dflash2_model(model_path: Path) -> None:
    draft_path = model_path / "dflash"
    if not _is_complete_mlx_model(draft_path):
        raise RuntimeError("The bundled DFlash2 model is incomplete")
    manifest_path = model_path / MLX_MODEL_MANIFEST
    manifest = _read_model_manifest(manifest_path)
    if not manifest:
        raise RuntimeError("The downloaded MLX model manifest is missing")
    manifest["dflash2_subdirectory"] = "dflash"
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def _is_complete_mlx_model(path: Path) -> bool:
    return (path / "config.json").is_file() and any(path.glob("*.safetensors"))


def get_downloaded_mlx_model_path(model_path: str) -> Path:
    repository = model_path.removeprefix("mlx/")
    destination = _repository_path(repository).resolve()
    if MLX_MODELS_DIR.resolve() not in destination.parents or not (destination / MLX_MODEL_MANIFEST).is_file():
        raise ValueError("The selected MLX model has not been downloaded")
    return destination


def _remove_empty_mlx_parent_directories(start: Path) -> None:
    models_root = MLX_MODELS_DIR.resolve()
    current = start.resolve()
    while current != models_root and models_root in current.parents:
        try:
            current.rmdir()
        except OSError:
            break
        current = current.parent


def delete_downloaded_mlx_model(model_path: str) -> None:
    """Delete one validated MLX repository and an unreferenced MTP companion."""
    destination = get_downloaded_mlx_model_path(model_path)
    manifest = _read_model_manifest(destination / MLX_MODEL_MANIFEST)
    companion_repositories = {
        "mtp": manifest.get("mtp_repository"),
        "dflash2": manifest.get("dflash2_repository"),
    }
    shutil.rmtree(destination)
    _remove_empty_mlx_parent_directories(destination.parent)

    for role, repository in companion_repositories.items():
        if not isinstance(repository, str):
            continue
        companion_destination = _repository_path(repository)
        manifest_key = f"{role}_repository"
        is_still_referenced = any(
            _read_model_manifest(path).get(manifest_key) == repository
            for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST) if path.is_file()
        )
        companion_manifest = _read_model_manifest(companion_destination / MLX_MODEL_MANIFEST)
        if not is_still_referenced and companion_manifest.get("role") == role:
            shutil.rmtree(companion_destination)
            _remove_empty_mlx_parent_directories(companion_destination.parent)


def _read_pid() -> int | None:
    try:
        return int(MLX_RUNTIME_PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _wait_for_process_exit(pid: int, timeout_seconds: float) -> bool:
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() < deadline:
        try:
            state = subprocess.check_output(
                ["ps", "-p", str(pid), "-o", "stat="], text=True,
            ).strip()
        except (OSError, ValueError, subprocess.SubprocessError):
            return True
        if not state or state.upper().startswith("Z"):
            return True
        time.sleep(0.1)
    return False


def stop_mlx_runtime() -> None:
    global _active_dflash2_model, _mlx_runtime_process
    _active_dflash2_model = None
    pid = _read_pid()
    if pid is None:
        return
    if _mlx_runtime_process is not None and _mlx_runtime_process.pid == pid \
            and _mlx_runtime_process.poll() is not None:
        _mlx_runtime_process.wait()
        _mlx_runtime_process = None
        MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
        return
    try:
        command = subprocess.check_output(["ps", "-p", str(pid), "-o", "command="], text=True)
    except (OSError, ValueError, subprocess.SubprocessError):
        MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
        return
    if "mlx_vlm.server" not in command and "mlx_lm.server" not in command and "omlx" not in command:
        MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
        raise RuntimeError("Vyact MLX PID no longer refers to a managed MLX server")
    if _mlx_runtime_process is not None and _mlx_runtime_process.pid == pid:
        _mlx_runtime_process.terminate()
    else:
        os.kill(pid, signal.SIGTERM)
    if not _wait_for_process_exit(pid, _MLX_RUNTIME_GRACEFUL_STOP_SECONDS):
        if _mlx_runtime_process is not None and _mlx_runtime_process.pid == pid:
            _mlx_runtime_process.kill()
        else:
            os.kill(pid, signal.SIGKILL)
        if not _wait_for_process_exit(pid, _MLX_RUNTIME_FORCE_STOP_SECONDS):
            raise RuntimeError("The existing MLX runtime did not stop in time")
    if _mlx_runtime_process is not None and _mlx_runtime_process.pid == pid:
        try:
            _mlx_runtime_process.wait(timeout=0)
        except subprocess.TimeoutExpired:
            pass
        _mlx_runtime_process = None
    MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)


def server_module_for_model(model_path: Path) -> str:
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("The MLX model config.json could not be read") from error
    architectures = " ".join(str(value).lower() for value in config.get("architectures", []))
    is_vision_model = bool(config.get("vision_config")) or any(
        marker in architectures for marker in ("vision", "conditionalgeneration", "vl")
    )
    return "mlx_vlm.server" if is_vision_model else "mlx_lm.server"


# Retain the private name used by existing callers and tests.
_server_module_for_model = server_module_for_model


@lru_cache(maxsize=2)
def _server_help(server_module: str) -> str:
    try:
        return subprocess.check_output(
            [sys.executable, "-m", server_module, "--help"],
            stderr=subprocess.STDOUT, text=True, timeout=30,
        )
    except (OSError, subprocess.SubprocessError):
        return ""


def get_mlx_runtime_capabilities(model_path: Path) -> dict:
    """Report advanced controls supported by the installed MLX server."""
    server_help = _server_help(server_module_for_model(model_path))
    return {
        "performance_modes": [],
        "cpu_threads": False,
        "kv_cache_precisions": ["q8", "q4"] if "--kv-bits" in server_help else [],
        "seed": True,
    }


def _build_mlx_server_command(
        model_path: Path, context_size: int, cache_quantization: bool = True,
        enable_mtp: bool | None = None,
        kv_cache_precision: str | None = None,
) -> list[str]:
    manifest = _read_model_manifest(model_path / MLX_MODEL_MANIFEST)
    mtp_repository = manifest.get("mtp_repository")
    try:
        mtp_path = _repository_path(mtp_repository) if isinstance(mtp_repository, str) else None
    except ValueError:
        mtp_path = None
    if mtp_path is not None and not (mtp_path / MLX_MODEL_MANIFEST).is_file():
        mtp_path = None
    if enable_mtp is False:
        mtp_path = None
    server_module = "mlx_vlm.server" if mtp_path is not None else server_module_for_model(model_path)
    command = [
        sys.executable, "-m", server_module, "--model", str(model_path),
        "--host", "127.0.0.1", "--port", str(VYACT_RUNTIME_PORT),
        "--max-kv-size", str(context_size),
    ]
    server_help = _server_help(server_module)
    kv_cache_precision = kv_cache_precision or ("q8" if cache_quantization else "none")
    if (
        kv_cache_precision != "none"
        and mtp_path is None
        and context_size >= _MLX_KV_QUANTIZATION_MIN_CONTEXT
        and "--kv-bits" in server_help
    ):
        command.extend(["--kv-bits", "4" if kv_cache_precision == "q4" else "8"])
        if "--quantized-kv-start" in server_help:
            command.extend(["--quantized-kv-start", "0"])
    if mtp_path is not None:
        command.extend(["--draft-model", str(mtp_path), "--draft-kind", "mtp"])
    return command


def _get_dflash2_path(model_path: Path) -> Path | None:
    manifest = _read_model_manifest(model_path / MLX_MODEL_MANIFEST)
    if manifest.get("dflash2_subdirectory") == "dflash":
        bundled_path = model_path / "dflash"
        return bundled_path if _is_complete_mlx_model(bundled_path) else None
    repository = manifest.get("dflash2_repository")
    if not isinstance(repository, str):
        return None
    try:
        path = _repository_path(repository)
    except ValueError:
        return None
    companion_manifest = _read_model_manifest(path / MLX_MODEL_MANIFEST)
    return path if companion_manifest.get("role") == "dflash2" else None


def _build_omlx_server_command(model_path: Path, dflash2_path: Path, context_size: int) -> tuple[list[str], dict[str, str]]:
    executable = shutil.which("omlx")
    if not executable:
        raise RuntimeError("oMLX is required for MLX DFlash2 acceleration")
    serving_model_id = model_path.name
    OMLX_BASE_DIR.mkdir(parents=True, exist_ok=True)
    settings = {
        "version": 1,
        "models": {
            serving_model_id: {
                "max_context_window": context_size,
                "dflash_enabled": True,
                "dflash_draft_model": str(dflash2_path),
                "dflash_in_memory_cache": True,
            },
        },
    }
    (OMLX_BASE_DIR / "model_settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    command = [
        executable, "serve", "--model-dir", str(MLX_MODELS_DIR),
        "--host", "127.0.0.1", "--port", str(VYACT_RUNTIME_PORT),
        "--max-concurrent-requests", "1",
    ]
    environment = {**os.environ, "OMLX_BASE_PATH": str(OMLX_BASE_DIR), "OMLX_MODEL_DIR": str(MLX_MODELS_DIR)}
    return command, environment


def _mlx_server_environment() -> dict[str, str]:
    _MLX_APC_DISK_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    return {
        **os.environ,
        "APC_ENABLED": "1",
        "APC_NUM_BLOCKS": str(_MLX_APC_NUM_BLOCKS),
        "APC_EXACT_CACHE_ENTRIES": str(_MLX_APC_EXACT_CACHE_ENTRIES),
        "APC_DEFAULT_TENANT": _MLX_APC_DEFAULT_TENANT,
        "APC_DISK_PATH": str(_MLX_APC_DISK_DIR),
        "APC_DISK_MAX_GB": str(_MLX_APC_DISK_MAX_GB),
    }


def start_mlx_model(
        model_path: Path, context_size: int, debug_logging: bool = False,
        cache_quantization: bool = True, enable_mtp: bool | None = None,
        kv_cache_precision: str | None = None, _performance_mode: str = "auto",
        _cpu_threads: int | None = None,
) -> str:
    global _active_dflash2_model, _mlx_runtime_process
    kv_cache_precision = kv_cache_precision or ("q8" if cache_quantization else "none")
    dflash2_path = _get_dflash2_path(model_path)
    if dflash2_path is None and enable_mtp is True and kv_cache_precision != "none":
        raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
    if not is_apple_silicon():
        raise RuntimeError("MLX models require Apple Silicon")
    try:
        import mlx_vlm  # noqa: F401
    except ImportError as error:
        raise RuntimeError(f"The MLX runtime could not be imported: {error}") from error
    from services.vyact_runtime import stop_runtime

    stop_runtime()
    stop_mlx_runtime()
    MLX_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    log_path = get_log_file("mlx-vlm")
    model_id = str(model_path)
    using_dflash2 = False
    if dflash2_path is not None:
        try:
            command, environment = _build_omlx_server_command(model_path, dflash2_path, context_size)
            model_id = model_path.relative_to(MLX_MODELS_DIR).as_posix()
            using_dflash2 = True
        except RuntimeError:
            command = _build_mlx_server_command(model_path, context_size, cache_quantization, False, kv_cache_precision)
            environment = _mlx_server_environment()
    else:
        command = _build_mlx_server_command(model_path, context_size, cache_quantization, enable_mtp, kv_cache_precision)
        environment = _mlx_server_environment()
    with log_path.open("ab") as log_file:
        process = subprocess.Popen(
            command,
            stdout=log_file,
            stderr=subprocess.STDOUT,
            start_new_session=True,
            env=environment,
        )
    _mlx_runtime_process = process
    MLX_RUNTIME_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    deadline = time.monotonic() + 180
    health_url = f"http://127.0.0.1:{VYACT_RUNTIME_PORT}/v1/models"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            if using_dflash2:
                process.wait()
                MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
                command = _build_mlx_server_command(
                    model_path, context_size, cache_quantization, False, kv_cache_precision,
                )
                with log_path.open("ab") as log_file:
                    process = subprocess.Popen(
                        command, stdout=log_file, stderr=subprocess.STDOUT,
                        start_new_session=True, env=_mlx_server_environment(),
                    )
                _mlx_runtime_process = process
                MLX_RUNTIME_PID_FILE.write_text(str(process.pid), encoding="utf-8")
                using_dflash2 = False
                model_id = str(model_path)
                deadline = time.monotonic() + 180
                continue
            raise RuntimeError("MLX runtime stopped while loading the model")
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                if response.status == 200:
                    if using_dflash2:
                        try:
                            payload = json.load(response)
                            available_ids = [
                                str(item.get("id")) for item in payload.get("data", [])
                                if isinstance(item, dict) and item.get("id")
                            ]
                            model_id = (
                                model_path.name
                                if model_path.name in available_ids or not available_ids
                                else available_ids[0]
                            )
                        except (AttributeError, TypeError, ValueError):
                            model_id = model_path.name
                    _active_dflash2_model = f"mlx/{model_path.relative_to(MLX_MODELS_DIR).as_posix()}" if using_dflash2 else None
                    return model_id
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError("The MLX model did not become ready within 180 seconds")
