"""Persistent location of managed GGUF/MLX models, independent of app data."""
import hashlib
import json
import os
import shutil
import tempfile
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Callable

from config import INSTALL_DIR

STORAGE_CONFIG = INSTALL_DIR / "model-storage.json"
DEFAULT_MODELS_DIRECTORY_NAME = "models"
EXTERNAL_MODELS_DIRECTORY_NAME = "vyact_models"
COPY_CHUNK_BYTES = 8 * 1024 * 1024
active_move = False
active_downloads = 0
operation_lock = threading.Lock()
move_status: dict = {"phase": "idle", "copied_bytes": 0, "total_bytes": 0}


@contextmanager
def download_operation():
    """Keep detached download workers alive in the relocation exclusion check."""
    global active_downloads
    with operation_lock:
        if active_move:
            raise ValueError("storage_busy")
        active_downloads += 1
    try:
        yield
    finally:
        with operation_lock:
            active_downloads -= 1


def get_configured_models_dir() -> Path:
    if not STORAGE_CONFIG.exists():
        return INSTALL_DIR / DEFAULT_MODELS_DIRECTORY_NAME
    # A missing external drive must never silently fall back to the system disk.
    value = json.loads(STORAGE_CONFIG.read_text(encoding="utf-8"))
    path = Path(value["path"])
    if not path.is_absolute():
        raise ValueError("invalid_storage_path")
    return path


def get_models_dir() -> Path:
    path = get_configured_models_dir()
    if STORAGE_CONFIG.exists() and not path.is_dir():
        raise ValueError("storage_unavailable")
    return path


def _model_entries(source: Path) -> list[Path]:
    # RAG embeddings use a separate runtime and retain their own installation path.
    return [path for path in source.rglob("*")
            if path.relative_to(source).parts[0] != "embeddings"] if source.exists() else []


def get_mlx_models_dir() -> Path:
    return get_models_dir() / "mlx"


def save_models_dir(path: Path) -> None:
    STORAGE_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=".model-storage-", dir=STORAGE_CONFIG.parent)
    try:
        with os.fdopen(descriptor, "w", encoding="utf-8") as output:
            json.dump({"path": str(path)}, output)
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, STORAGE_CONFIG)
    finally:
        Path(temporary).unlink(missing_ok=True)


def _validate_destination(destination: Path) -> None:
    """Only the dedicated root is owned by Vyact; never adopt a populated folder."""
    if destination.is_symlink() or (destination.exists() and not destination.is_dir()):
        raise ValueError("storage_not_empty")
    if not destination.exists():
        return
    default_root = (INSTALL_DIR / DEFAULT_MODELS_DIRECTORY_NAME).resolve()
    for entry in destination.iterdir():
        if destination == default_root and entry.name == "embeddings" and entry.is_dir() and not entry.is_symlink():
            continue
        raise ValueError("storage_not_empty")


def plan_move(raw_path: str) -> dict:
    source = get_models_dir().resolve()
    candidate = Path(raw_path).expanduser()
    if not raw_path.strip() or not candidate.is_absolute():
        raise ValueError("invalid_storage_path")
    selected = candidate.resolve(strict=True)
    if not selected.is_dir():
        raise ValueError("invalid_storage_path")
    # Existing custom roots remain usable; reselecting one must never nest models.
    default_root = (INSTALL_DIR / DEFAULT_MODELS_DIRECTORY_NAME).resolve()
    if selected in {source, default_root} or selected.name.casefold() == EXTERNAL_MODELS_DIRECTORY_NAME:
        destination = selected
    elif selected == INSTALL_DIR.resolve():
        destination = default_root
    else:
        destination = selected / EXTERNAL_MODELS_DIRECTORY_NAME
    if destination != selected and destination.is_symlink():
        raise ValueError("storage_not_empty")
    plan = {"source": str(source), "destination": str(destination), "selected_directory": str(selected)}
    if source == destination or (source.exists() and destination.exists() and source.samefile(destination)):
        return {**plan, "same": True, "total_bytes": 0}
    if source in destination.parents or destination in source.parents:
        raise ValueError("nested_storage_path")
    _validate_destination(destination)
    files = _model_entries(source)
    if any(path.is_symlink() or not (path.is_file() or path.is_dir()) for path in files):
        raise ValueError("storage_links_unsupported")
    total = sum(path.stat().st_size for path in files if path.is_file())
    if shutil.disk_usage(selected).free < total:
        raise ValueError("storage_space")
    return {**plan, "same": False, "total_bytes": total, "file_count": sum(path.is_file() for path in files)}


def copy_models(plan: dict, progress: Callable[..., None]) -> list[Path]:
    """Copy and verify before switching the pointer; never remove source on failure."""
    source, destination = Path(plan["source"]), Path(plan["destination"])
    created: list[Path] = []
    copied = 0
    plan["source_signatures"] = {}
    try:
        _validate_destination(destination)
        if not destination.exists():
            destination.mkdir()
            created.append(destination)
        for original in sorted(_model_entries(source)):
            relative = original.relative_to(source)
            target = destination / relative
            if original.is_symlink():
                raise ValueError("storage_links_unsupported")
            if original.is_dir():
                target.mkdir()  # An unexpected conflict is an error, not an overwrite.
                created.append(target)
                continue
            original_stat = original.stat()
            digest = hashlib.sha256()
            with original.open("rb") as input_file, target.open("xb") as output:
                created.append(target)
                while chunk := input_file.read(COPY_CHUNK_BYTES):
                    output.write(chunk)
                    digest.update(chunk)
                    copied += len(chunk)
                    progress(phase="copying", copied_bytes=copied, current_file=str(relative))
                output.flush()
                os.fsync(output.fileno())
            progress(phase="verifying", current_file=str(relative))
            with target.open("rb") as copied_file:
                verified = hashlib.file_digest(copied_file, "sha256").digest()
            current_stat = original.stat()
            if digest.digest() != verified or (original_stat.st_size, original_stat.st_mtime_ns) != (current_stat.st_size, current_stat.st_mtime_ns):
                raise ValueError("storage_verification")
            shutil.copystat(original, target)
            plan["source_signatures"][str(relative)] = (current_stat.st_size, current_stat.st_mtime_ns)
        return created
    except BaseException:
        remove_copies(created)
        raise


def remove_copies(created: list[Path]) -> None:
    for path in reversed(created):
        try:
            path.rmdir() if path.is_dir() else path.unlink(missing_ok=True)
        except OSError:
            pass


def clean_source(plan: dict, created: list[Path]) -> bool:
    """Only remove files copied by this job, leaving unexpected new files intact."""
    source, destination = Path(plan["source"]), Path(plan["destination"])
    clean = True
    for target in reversed(created):
        if target == destination:
            continue
        original = source / target.relative_to(destination)
        try:
            if target.is_dir():
                original.rmdir()
            else:
                stat = original.stat()
                if (stat.st_size, stat.st_mtime_ns) != plan["source_signatures"].get(str(target.relative_to(destination))):
                    clean = False
                    continue
                original.unlink()
        except OSError:
            clean = False
    return clean
