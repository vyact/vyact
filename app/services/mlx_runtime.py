"""Managed Apple Silicon MLX-VLM model downloads and OpenAI-compatible runtime."""
import asyncio
import hashlib
import json
import logging
import os
import platform
import shutil
import signal
import struct
import subprocess
import threading
import time
import urllib.error
import urllib.request
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from tqdm.auto import tqdm

from config import INSTALL_DIR, get_log_file
from services.local_model_errors import LocalModelNotDownloadedError
from services.hardware_info import get_local_hardware_info
from services.omlx_policy import (
    MAX_SPECPREFILL_DRAFT_BYTES,
    MAX_SPECPREFILL_TARGET_SIZE_RATIO, OMLX_SPECPREFILL_THRESHOLD,
    SPECPREFILL_KEEP_PCT, SPECPREFILL_THRESHOLD_TOKENS,
    VLM_MTP_DRAFT_BLOCK_SIZE, is_external_mtp_compatible, model_type,
    recommend_omlx_cache_sizes,
)
from services.runtime_error_details import classify_runtime_load_failure, runtime_startup_error
from services.vyact_runtime import VYACT_RUNTIME_PORT

MLX_MODELS_DIR = INSTALL_DIR / "models" / "mlx"
MLX_RUNTIME_DIR = INSTALL_DIR / "runtime"
MLX_RUNTIME_PID_FILE = MLX_RUNTIME_DIR / "omlx.pid"
LEGACY_MLX_RUNTIME_PID_FILE = MLX_RUNTIME_DIR / "mlx-vlm.pid"
OMLX_BASE_DIR = MLX_RUNTIME_DIR / "omlx"
MLX_MODEL_MANIFEST = ".vyact-mlx-model.json"
_HF_ONLINE_DOWNLOAD_LOCK = threading.Lock()
_MLX_RUNTIME_GRACEFUL_STOP_SECONDS = 30
_MLX_RUNTIME_FORCE_STOP_SECONDS = 5
_OMLX_CACHE_DIR = MLX_RUNTIME_DIR / "prompt-cache"
_mlx_runtime_process: subprocess.Popen | None = None
_active_dflash2_model: str | None = None
logger = logging.getLogger(__name__)


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


def get_omlx_update_commands() -> list[list[str]]:
    brew = shutil.which("brew")
    return [[brew, "upgrade", "omlx"]] if brew and shutil.which("omlx") else []


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
    existing_manifest = _read_model_manifest(destination / MLX_MODEL_MANIFEST)
    effective_role = "model" if role == "model" or existing_manifest.get("role") == "model" else role
    (destination / MLX_MODEL_MANIFEST).write_text(json.dumps({
        **existing_manifest,
        "repository": repository,
        "revision": revision,
        "role": effective_role,
    }), encoding="utf-8")
    return destination


def get_mlx_downloaded_bytes(repository: str) -> int:
    """Return bytes physically written for an in-progress MLX download.

    hf_xet reconstructs sparse safetensors files and doesn't consistently emit
    tqdm byte updates. ``st_blocks`` reflects the data actually written instead
    of the files' preallocated logical size.
    """
    destination = _repository_path(repository)
    downloaded_bytes = 0
    for path in destination.rglob("*"):
        if not path.is_file():
            continue
        try:
            file_stat = path.stat()
        except OSError:
            continue
        allocated_blocks = getattr(file_stat, "st_blocks", None)
        downloaded_bytes += allocated_blocks * 512 if allocated_blocks is not None else file_stat.st_size
    return downloaded_bytes


def associate_mlx_mtp_model(model_path: Path, mtp_repository: str, mtp_path: Path) -> None:
    manifest_path = model_path / MLX_MODEL_MANIFEST
    manifest = _read_model_manifest(manifest_path)
    if not manifest:
        raise RuntimeError("The downloaded MLX model manifest is missing")
    if mtp_path != _repository_path(mtp_repository):
        raise ValueError("The MTP model path does not match its repository")
    manifest["mtp_repository"] = mtp_repository
    manifest_path.write_text(json.dumps(manifest), encoding="utf-8")


def associate_mlx_specprefill_model(model_path: Path, repository: str, draft_path: Path) -> None:
    manifest_path = model_path / MLX_MODEL_MANIFEST
    manifest = _read_model_manifest(manifest_path)
    if not manifest:
        raise RuntimeError("The downloaded MLX model manifest is missing")
    if draft_path != _repository_path(repository):
        raise ValueError("The SpecPrefill model path does not match its repository")
    if not _is_compatible_specprefill_draft(model_path, draft_path):
        raise ValueError("The SpecPrefill draft is incompatible with the target model")
    manifest["specprefill_repository"] = repository
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
        raise LocalModelNotDownloadedError("The selected MLX model has not been downloaded")
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
    """Delete one validated MLX repository and its unreferenced companions."""
    destination = get_downloaded_mlx_model_path(model_path)
    manifest = _read_model_manifest(destination / MLX_MODEL_MANIFEST)
    companion_repositories = {
        "mtp": manifest.get("mtp_repository"),
        "specprefill": manifest.get("specprefill_repository"),
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


def _read_pid() -> tuple[int | None, Path]:
    for pid_file in (MLX_RUNTIME_PID_FILE, LEGACY_MLX_RUNTIME_PID_FILE):
        try:
            return int(pid_file.read_text(encoding="utf-8").strip()), pid_file
        except (OSError, ValueError):
            continue
    return None, MLX_RUNTIME_PID_FILE


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
    pid, pid_file = _read_pid()
    if pid is None:
        return
    if _mlx_runtime_process is not None and _mlx_runtime_process.pid == pid \
            and _mlx_runtime_process.poll() is not None:
        _mlx_runtime_process.wait()
        _mlx_runtime_process = None
        pid_file.unlink(missing_ok=True)
        return
    try:
        command = subprocess.check_output(["ps", "-p", str(pid), "-o", "command="], text=True)
    except (OSError, ValueError, subprocess.SubprocessError):
        pid_file.unlink(missing_ok=True)
        return
    is_legacy_runtime = pid_file == LEGACY_MLX_RUNTIME_PID_FILE and any(
        legacy_name in command for legacy_name in ("mlx_vlm.server", "mlx_lm.server")
    )
    if "omlx" not in command and not is_legacy_runtime:
        pid_file.unlink(missing_ok=True)
        raise RuntimeError("Vyact oMLX PID no longer refers to the managed oMLX server")
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
    pid_file.unlink(missing_ok=True)


def get_mlx_runtime_capabilities(model_path: Path) -> dict:
    """Report controls supported by the managed oMLX runtime."""
    return {
        "performance_modes": [],
        "cpu_threads": False,
        "kv_cache_precisions": [],
        "seed": True,
    }


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


def _read_safetensors_header(model_path: Path) -> dict:
    """Read a local safetensors header without loading its tensor data."""
    weight_path = next(model_path.glob("*.safetensors"), None)
    if weight_path is None:
        return {}
    try:
        with weight_path.open("rb") as weight_file:
            header_size_bytes = weight_file.read(8)
            if len(header_size_bytes) != 8:
                return {}
            header_size = struct.unpack("<Q", header_size_bytes)[0]
            if header_size > 100 * 1024 * 1024:
                return {}
            header = json.loads(weight_file.read(header_size))
    except (OSError, json.JSONDecodeError, struct.error):
        return {}
    return header if isinstance(header, dict) else {}


def _read_safetensors_metadata(model_path: Path) -> dict[str, str]:
    metadata = _read_safetensors_header(model_path).get("__metadata__")
    if not isinstance(metadata, dict):
        return {}
    return {str(key): str(value) for key, value in metadata.items()}


def _get_dflash2_quantization_config(dflash2_path: Path) -> dict:
    header = _read_safetensors_header(dflash2_path)
    metadata = header.get("__metadata__")
    if not isinstance(metadata, dict):
        return {}
    try:
        weight_bits = int(metadata["bits"])
        group_size = int(metadata["group_size"])
    except (KeyError, TypeError, ValueError):
        return {}
    if weight_bits not in {2, 4, 8} or group_size not in {32, 64, 128}:
        return {}
    quantization = {"group_size": group_size, "bits": weight_bits, "mode": "affine"}
    for tensor_name, tensor_info in header.items():
        if not tensor_name.endswith(".scales") or not isinstance(tensor_info, dict):
            continue
        module_name = tensor_name.removesuffix(".scales")
        weight_info = header.get(f"{module_name}.weight")
        scales_shape = tensor_info.get("shape")
        weight_shape = weight_info.get("shape") if isinstance(weight_info, dict) else None
        if not (
            isinstance(scales_shape, list) and len(scales_shape) == 2
            and isinstance(weight_shape, list) and len(weight_shape) == 2
            and scales_shape[1]
        ):
            continue
        module_bits = weight_shape[1] * 32 // (scales_shape[1] * group_size)
        if module_bits in {2, 4, 8} and module_bits != weight_bits:
            quantization[module_name] = {
                "group_size": group_size, "bits": module_bits, "mode": "affine",
            }
    return quantization


def _prepare_omlx_dflash2_path(dflash2_path: Path, serving_model_id: str) -> Path:
    quantization = _get_dflash2_quantization_config(dflash2_path)
    if not quantization:
        return dflash2_path
    try:
        config = json.loads((dflash2_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return dflash2_path
    if not isinstance(config, dict):
        return dflash2_path
    config["quantization"] = quantization
    overlay_path = OMLX_BASE_DIR / "dflash-drafts" / serving_model_id
    overlay_path.mkdir(parents=True, exist_ok=True)
    (overlay_path / "config.json").write_text(json.dumps(config, indent=2), encoding="utf-8")
    for weight_path in dflash2_path.glob("model*.safetensors"):
        overlay_weight_path = overlay_path / weight_path.name
        if overlay_weight_path.is_symlink() and overlay_weight_path.resolve() == weight_path.resolve():
            continue
        if overlay_weight_path.exists() or overlay_weight_path.is_symlink():
            overlay_weight_path.unlink()
        overlay_weight_path.symlink_to(weight_path.resolve())
    return overlay_path


def _get_manifest_companion_path(
        model_path: Path, key: str, role: str | tuple[str, ...],
) -> Path | None:
    repository = _read_model_manifest(model_path / MLX_MODEL_MANIFEST).get(key)
    if not isinstance(repository, str):
        return None
    try:
        path = _repository_path(repository)
    except ValueError:
        return None
    manifest = _read_model_manifest(path / MLX_MODEL_MANIFEST)
    accepted_roles = (role,) if isinstance(role, str) else role
    return path if manifest.get("role") in accepted_roles and _is_complete_mlx_model(path) else None


def _tokenizer_identity(model_path: Path) -> tuple[str, str] | None:
    """Hash the actual token-ID mapping read from the tokenizer files.

    SpecPrefill receives token IDs produced by the target tokenizer, so wrapper
    class, decoder, and pre-tokenizer serialization differences do not affect
    draft compatibility. The vocabulary/model and added-token mapping must be
    byte-for-byte equal after deterministic JSON serialization.
    """
    try:
        tokenizer = json.loads((model_path / "tokenizer_config.json").read_text(encoding="utf-8"))
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return None
    text_config = config.get("text_config") if isinstance(config.get("text_config"), dict) else {}
    vocab_size = str(text_config.get("vocab_size") or config.get("vocab_size") or tokenizer.get("vocab_size") or "")
    tokenizer_json_path = model_path / "tokenizer.json"
    if not vocab_size:
        return None
    digest = hashlib.sha256()
    if tokenizer_json_path.is_file():
        try:
            tokenizer_json = json.loads(tokenizer_json_path.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            return None
        token_mapping = {
            key: tokenizer_json.get(key)
            for key in ("model", "added_tokens")
        }
        digest.update(json.dumps(
            token_mapping, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
        ).encode("utf-8"))
    else:
        tokenizer_files = [
            path for path in (
                model_path / "tokenizer.model",
                model_path / "vocab.json",
                model_path / "merges.txt",
            ) if path.is_file()
        ]
        if not tokenizer_files:
            return None
        for path in tokenizer_files:
            digest.update(path.name.encode("utf-8"))
            digest.update(b"\0")
            try:
                digest.update(path.read_bytes())
            except OSError:
                return None
            digest.update(b"\0")
    return vocab_size, digest.hexdigest()


def _model_config(model_path: Path) -> dict:
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return config if isinstance(config, dict) else {}


def _compatible_external_mtp_path(model_path: Path) -> Path | None:
    draft_path = _get_manifest_companion_path(model_path, "mtp_repository", "mtp")
    if draft_path is None:
        return None
    return draft_path if is_external_mtp_compatible(
        _model_config(model_path), _model_config(draft_path),
    ) else None


def _compatible_specprefill_path(model_path: Path) -> Path | None:
    draft_path = _get_manifest_companion_path(
        model_path, "specprefill_repository", ("specprefill", "model"),
    )
    if draft_path is None:
        return None
    return draft_path if _is_compatible_specprefill_draft(model_path, draft_path) else None


def _mlx_model_size(model_path: Path) -> int:
    try:
        return sum(path.stat().st_size for path in model_path.glob("*.safetensors") if path.is_file())
    except OSError:
        return 0


def _config_vocab_size(config: dict) -> int:
    text_config = config.get("text_config") if isinstance(config.get("text_config"), dict) else {}
    try:
        return int(text_config.get("vocab_size") or config.get("vocab_size") or 0)
    except (TypeError, ValueError):
        return 0


def _is_compatible_specprefill_draft(model_path: Path, draft_path: Path) -> bool:
    """Apply the same architecture, vocabulary, size, and exact-tokenizer gates locally."""
    target_config = _model_config(model_path)
    draft_config = _model_config(draft_path)
    target_size = _mlx_model_size(model_path)
    draft_size = _mlx_model_size(draft_path)
    target_identity = _tokenizer_identity(model_path)
    draft_identity = _tokenizer_identity(draft_path)
    return (
        bool(model_type(target_config))
        and model_type(target_config) == model_type(draft_config)
        and _config_vocab_size(target_config) > 0
        and _config_vocab_size(target_config) == _config_vocab_size(draft_config)
        and 0 < draft_size <= MAX_SPECPREFILL_DRAFT_BYTES
        and target_size > draft_size
        and draft_size <= target_size * MAX_SPECPREFILL_TARGET_SIZE_RATIO
        and target_identity is not None
        and target_identity == draft_identity
    )


def _find_installed_specprefill_draft(model_path: Path) -> tuple[str, Path] | None:
    """Find the smallest compatible installed draft without changing companion manifests."""
    candidates: list[tuple[int, str, Path]] = []
    for manifest_path in MLX_MODELS_DIR.rglob(MLX_MODEL_MANIFEST) if MLX_MODELS_DIR.is_dir() else []:
        draft_manifest = _read_model_manifest(manifest_path)
        repository = draft_manifest.get("repository")
        draft_path = manifest_path.parent
        if (
            draft_manifest.get("role") == "specprefill"
            and isinstance(repository, str)
            and _is_complete_mlx_model(draft_path)
            and _is_compatible_specprefill_draft(model_path, draft_path)
        ):
            try:
                if draft_path.resolve() != _repository_path(repository).resolve():
                    continue
            except (OSError, ValueError):
                continue
            candidates.append((_mlx_model_size(draft_path), repository, draft_path))
    if not candidates:
        return None
    _, repository, draft_path = min(candidates, key=lambda candidate: candidate[0])
    return repository, draft_path


def prepare_mlx_specprefill_draft(
        model_path: Path, token: str | None = None, enable_mtp: bool | None = None,
        allow_download: bool = True,
) -> bool:
    """Download and attach one compatible small draft before a regular oMLX load."""
    if enable_mtp is not False and _compatible_external_mtp_path(model_path) is not None:
        return False
    if _get_dflash2_path(model_path) is not None:
        return False
    if _compatible_specprefill_path(model_path) is not None:
        return True
    installed_draft = _find_installed_specprefill_draft(model_path)
    if installed_draft is not None:
        repository, draft_path = installed_draft
        associate_mlx_specprefill_model(model_path, repository, draft_path)
        return True
    if not allow_download:
        return False
    manifest = _read_model_manifest(model_path / MLX_MODEL_MANIFEST)
    repository = manifest.get("repository")
    if not isinstance(repository, str) or not repository:
        return False
    from services.huggingface_models import search_mlx_models

    models = asyncio.run(search_mlx_models(repository.rsplit("/", 1)[-1], token))
    target = next((model for model in models if model.get("id") == repository), None)
    draft = target.get("specprefill_model") if isinstance(target, dict) else None
    if not isinstance(draft, dict):
        return False
    draft_repository = str(draft.get("repository") or "")
    draft_revision = str(draft.get("revision") or "main")
    if not draft_repository:
        return False
    draft_path = download_mlx_model(
        draft_repository, draft_revision, token, role="specprefill",
    )
    associate_mlx_specprefill_model(model_path, draft_repository, draft_path)
    return _compatible_specprefill_path(model_path) is not None


def get_mlx_speculative_mode(model_path: Path, enable_mtp: bool | None = None) -> str:
    """Return the single speculative path that oMLX will configure."""
    if enable_mtp is not False and _compatible_external_mtp_path(model_path):
        return "external_mtp"
    if _get_dflash2_path(model_path):
        return "dflash2"
    return "none"


def _configured_compatible_specprefill_path(model_path: Path) -> Path | None:
    """Migrate a previously configured oMLX draft only after compatibility checks."""
    try:
        settings = json.loads((OMLX_BASE_DIR / "model_settings.json").read_text(encoding="utf-8"))
        model_settings = settings.get("models", {}).get(model_path.name, {})
        draft_value = model_settings.get("specprefill_draft_model")
        if not isinstance(draft_value, str) or not draft_value.strip():
            return None
        draft_path = Path(draft_value).expanduser().resolve()
    except (OSError, json.JSONDecodeError, TypeError):
        return None
    if not draft_path.is_dir() or not _is_complete_mlx_model(draft_path):
        return None
    return draft_path if _is_compatible_specprefill_draft(model_path, draft_path) else None


def _build_omlx_server_command(
        model_path: Path, context_size: int, enable_mtp: bool | None = None,
) -> tuple[list[str], dict[str, str], str]:
    executable = shutil.which("omlx")
    if not executable:
        raise RuntimeError("oMLX is required to run MLX models")
    serving_model_id = model_path.name
    OMLX_BASE_DIR.mkdir(parents=True, exist_ok=True)
    dflash2_path = _get_dflash2_path(model_path)
    external_mtp_path = _compatible_external_mtp_path(model_path)
    if enable_mtp is False:
        external_mtp_path = None
    model_settings = {
        "max_context_window": context_size,
        "mtp_enabled": False,
        "specprefill_enabled": False,
    }
    speculative_mode = get_mlx_speculative_mode(model_path, enable_mtp)
    if external_mtp_path is not None:
        model_settings.update({
            "vlm_mtp_enabled": True,
            "vlm_mtp_draft_model": str(external_mtp_path),
            "vlm_mtp_draft_block_size": VLM_MTP_DRAFT_BLOCK_SIZE,
            "specprefill_enabled": False,
        })
    elif dflash2_path is not None:
        serving_dflash2_path = _prepare_omlx_dflash2_path(dflash2_path, serving_model_id)
        model_settings.update({
            "dflash_enabled": True,
            "dflash_draft_model": str(serving_dflash2_path),
            "dflash_in_memory_cache": True,
            "specprefill_enabled": False,
        })
    settings = {
        "version": 1,
        "models": {serving_model_id: model_settings},
    }
    (OMLX_BASE_DIR / "model_settings.json").write_text(json.dumps(settings, indent=2), encoding="utf-8")
    hardware = get_local_hardware_info()
    total_memory_bytes = int(hardware.get("system_memory", {}).get("total_bytes") or 0)
    paged_cache_size, hot_cache_size = recommend_omlx_cache_sizes(total_memory_bytes)
    command = [
        executable, "serve", "--model-dir", str(MLX_MODELS_DIR),
        "--host", "127.0.0.1", "--port", str(VYACT_RUNTIME_PORT),
        "--max-concurrent-requests", "1",
        "--paged-ssd-cache-dir", str(_OMLX_CACHE_DIR),
        "--paged-ssd-cache-max-size", paged_cache_size,
        "--hot-cache-max-size", hot_cache_size,
        "--hot-cache-write-through",
    ]
    _OMLX_CACHE_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    environment = {**os.environ, "OMLX_BASE_PATH": str(OMLX_BASE_DIR), "OMLX_MODEL_DIR": str(MLX_MODELS_DIR)}
    return command, environment, speculative_mode


def start_mlx_model(
        model_path: Path, context_size: int, debug_logging: bool = False,
        cache_quantization: bool = True, enable_mtp: bool | None = None,
        kv_cache_precision: str | None = None, _performance_mode: str = "auto",
        _cpu_threads: int | None = None,
        runtime_status: dict | None = None,
) -> str:
    global _active_dflash2_model, _mlx_runtime_process
    if not is_apple_silicon():
        raise RuntimeError("MLX models require Apple Silicon")
    from services.vyact_runtime import stop_runtime

    stop_runtime()
    stop_mlx_runtime()
    MLX_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    log_path = get_log_file("omlx")
    command, environment, speculative_mode = _build_omlx_server_command(
        model_path, context_size, enable_mtp,
    )
    model_id = model_path.relative_to(MLX_MODELS_DIR).as_posix()
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
    try:
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise runtime_startup_error("oMLX stopped while loading the model", log_path)
            try:
                with urllib.request.urlopen(health_url, timeout=2) as response:
                    if response.status == 200:
                        try:
                            payload = json.load(response)
                            available_ids = [
                                str(item.get("id")) for item in payload.get("data", [])
                                if isinstance(item, dict) and item.get("id")
                            ]
                            model_id = model_path.name if model_path.name in available_ids or not available_ids else available_ids[0]
                        except (AttributeError, TypeError, ValueError):
                            model_id = model_path.name
                        _active_dflash2_model = (
                            f"mlx/{model_path.relative_to(MLX_MODELS_DIR).as_posix()}"
                            if speculative_mode == "dflash2" else None
                        )
                        return model_id
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.25)
        raise runtime_startup_error("The oMLX model did not become ready within 180 seconds", log_path)
    except RuntimeError as error:
        if speculative_mode != "external_mtp" or enable_mtp is False:
            raise
        if runtime_status is not None:
            failure_code, failure_message = classify_runtime_load_failure(error)
            runtime_status.update({
                "mtp_fallback": True,
                "mtp_failure_code": failure_code,
                "mtp_failure_message": failure_message,
            })
        return start_mlx_model(
            model_path, context_size, debug_logging, cache_quantization, False,
            kv_cache_precision, _performance_mode, _cpu_threads, runtime_status,
        )
