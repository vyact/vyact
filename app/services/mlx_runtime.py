"""Managed Apple Silicon MLX-VLM model downloads and OpenAI-compatible runtime."""
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
from pathlib import Path
from typing import Callable

from tqdm.auto import tqdm

from config import INSTALL_DIR
from services.vyact_runtime import VYACT_RUNTIME_PORT

MLX_MODELS_DIR = INSTALL_DIR / "models" / "mlx"
MLX_RUNTIME_DIR = INSTALL_DIR / "runtime"
MLX_RUNTIME_PID_FILE = MLX_RUNTIME_DIR / "mlx-vlm.pid"
MLX_MODEL_MANIFEST = ".vyact-mlx-model.json"
_HF_ONLINE_DOWNLOAD_LOCK = threading.Lock()
_MLX_RUNTIME_GRACEFUL_STOP_SECONDS = 30
_MLX_RUNTIME_FORCE_STOP_SECONDS = 5


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


def get_downloaded_mlx_model_path(model_path: str) -> Path:
    repository = model_path.removeprefix("mlx/")
    destination = _repository_path(repository).resolve()
    if MLX_MODELS_DIR.resolve() not in destination.parents or not (destination / MLX_MODEL_MANIFEST).is_file():
        raise ValueError("The selected MLX model has not been downloaded")
    return destination


def delete_downloaded_mlx_model(model_path: str) -> None:
    """Delete one validated MLX repository and an unreferenced MTP companion."""
    destination = get_downloaded_mlx_model_path(model_path)
    manifest = _read_model_manifest(destination / MLX_MODEL_MANIFEST)
    mtp_repository = manifest.get("mtp_repository")
    shutil.rmtree(destination)

    if not isinstance(mtp_repository, str):
        return
    mtp_destination = _repository_path(mtp_repository)
    is_still_referenced = any(
        _read_model_manifest(path).get("mtp_repository") == mtp_repository
        for path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST)
        if path.is_file()
    )
    mtp_manifest = _read_model_manifest(mtp_destination / MLX_MODEL_MANIFEST)
    if not is_still_referenced and mtp_manifest.get("role") == "mtp":
        shutil.rmtree(mtp_destination)


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
    pid = _read_pid()
    if pid is None:
        return
    try:
        command = subprocess.check_output(["ps", "-p", str(pid), "-o", "command="], text=True)
    except (OSError, ValueError, subprocess.SubprocessError):
        MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
        return
    if "mlx_vlm.server" not in command and "mlx_lm.server" not in command:
        MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)
        raise RuntimeError("Vyact MLX PID no longer refers to mlx_vlm.server")
    os.kill(pid, signal.SIGTERM)
    if not _wait_for_process_exit(pid, _MLX_RUNTIME_GRACEFUL_STOP_SECONDS):
        os.kill(pid, signal.SIGKILL)
        if not _wait_for_process_exit(pid, _MLX_RUNTIME_FORCE_STOP_SECONDS):
            raise RuntimeError("The existing MLX runtime did not stop in time")
    MLX_RUNTIME_PID_FILE.unlink(missing_ok=True)


def _server_module_for_model(model_path: Path) -> str:
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise RuntimeError("The MLX model config.json could not be read") from error
    architectures = " ".join(str(value).lower() for value in config.get("architectures", []))
    is_vision_model = bool(config.get("vision_config")) or any(
        marker in architectures for marker in ("vision", "conditionalgeneration", "vl")
    )
    return "mlx_vlm.server" if is_vision_model else "mlx_lm.server"


def _build_mlx_server_command(model_path: Path, context_size: int) -> list[str]:
    manifest = _read_model_manifest(model_path / MLX_MODEL_MANIFEST)
    mtp_repository = manifest.get("mtp_repository")
    try:
        mtp_path = _repository_path(mtp_repository) if isinstance(mtp_repository, str) else None
    except ValueError:
        mtp_path = None
    if mtp_path is not None and not (mtp_path / MLX_MODEL_MANIFEST).is_file():
        mtp_path = None
    server_module = "mlx_vlm.server" if mtp_path is not None else _server_module_for_model(model_path)
    command = [
        sys.executable, "-m", server_module, "--model", str(model_path),
        "--host", "127.0.0.1", "--port", str(VYACT_RUNTIME_PORT),
        "--max-kv-size", str(context_size),
    ]
    if mtp_path is not None:
        command.extend(["--draft-model", str(mtp_path), "--draft-kind", "mtp"])
    return command


def start_mlx_model(model_path: Path, context_size: int, debug_logging: bool = False) -> str:
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
    log_path = MLX_RUNTIME_DIR / "mlx-vlm.log"
    command = _build_mlx_server_command(model_path, context_size)
    with log_path.open("ab") as log_file:
        process = subprocess.Popen(command, stdout=log_file, stderr=subprocess.STDOUT, start_new_session=True)
    MLX_RUNTIME_PID_FILE.write_text(str(process.pid), encoding="utf-8")
    deadline = time.monotonic() + 180
    health_url = f"http://127.0.0.1:{VYACT_RUNTIME_PORT}/v1/models"
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError("MLX runtime stopped while loading the model")
        try:
            with urllib.request.urlopen(health_url, timeout=2) as response:
                if response.status == 200:
                    return str(model_path)
        except (OSError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError("The MLX model did not become ready within 180 seconds")
