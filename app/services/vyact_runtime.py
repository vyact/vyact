"""Native llama.cpp + llama-swap runtime paths and configuration.

The desktop product deliberately does not use Docker for its default local
runtime.  In particular, a macOS container cannot use llama.cpp's Metal
backend, while a native llama-server can.
"""
from services.shutdown_guard import protected
from services.runtime_ports import get_runtime_port, get_model_port, is_port_conflict, with_runtime_ports
from services.pinned_runtime import managed_executable, install_pinned_components, runtime_environment
import asyncio
import hashlib
import json
import os
import platform
import shutil
import signal
import subprocess
import threading
import time
import urllib.error
import urllib.request

import psutil
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import quote

from services.model_storage import get_models_dir
from config import INSTALL_DIR, get_log_file
from logger import get_logger
from services.hardware_info import GPU_SPLIT_DECIMAL_PLACES, get_local_hardware_info, validate_gpu_split_percentages
from services.local_model_errors import LocalModelNotDownloadedError
from services.model_runtime_profiles import normalize_gpu_split_for_hardware
from services.multimodal_capabilities import get_projector_modalities
from services.runtime_error_details import classify_runtime_load_failure, runtime_startup_error
from services.runtime_log import start_logged_process, wait_for_process_log

logger = get_logger(__name__)

VYACT_RUNTIME_DIR = INSTALL_DIR / "runtime"
VYACT_SWAP_CONFIG = VYACT_RUNTIME_DIR / "llama-swap.yaml"
VYACT_RUNTIME_PID_FILE = VYACT_RUNTIME_DIR / "llama-swap.pid"
LLAMA_BATCH_SIZE = 2048
LLAMA_UBATCH_SIZE = 512
DEFAULT_CHAT_CONTEXT_SIZE = 32768
MINIMUM_SUPPORTED_CHAT_CONTEXT_SIZE = 512

_downloaded_models_lock = threading.RLock()
_downloaded_models_cache: frozenset[str] | None = None
_integrated_mtp_cache: dict[tuple[str, int, int], bool] = {}
_active_mtp_model: str | None = None
_active_dflash2_model: str | None = None
_runtime_process: subprocess.Popen | None = None


class RuntimePackageManagerMissingError(RuntimeError):
    """Raised when no supported installer can provide the native runtime."""


@dataclass(frozen=True)
class RuntimePaths:
    """Resolved executable and storage paths for the native local runtime."""

    llama_server: Path | None
    llama_swap: Path | None
    models_dir: Path
    config_file: Path


def _executable_name(name: str) -> str:
    return f"{name}.exe" if os.name == "nt" else name


def _known_executable_paths(name: str) -> list[Path]:
    """Return package-manager locations commonly absent from desktop app PATH."""
    executable = _executable_name(name)
    system = platform.system()
    if system == "Darwin":
        return [Path("/opt/homebrew/bin") / executable, Path("/usr/local/bin") / executable]
    if system == "Linux":
        return [
            Path("/home/linuxbrew/.linuxbrew/bin") / executable,
            Path("/usr/local/bin") / executable,
            Path("/usr/bin") / executable,
        ]
    if system == "Windows":
        local_app_data = os.environ.get("LOCALAPPDATA")
        if local_app_data:
            base = Path(local_app_data)
            candidates = [
                base / "Microsoft" / "WindowsApps" / executable,
                base / "Microsoft" / "WinGet" / "Links" / executable,
            ]
            packages_dir = base / "Microsoft" / "WinGet" / "Packages"
            if packages_dir.is_dir():
                candidates.extend(sorted(packages_dir.rglob(executable)))
            return candidates
    return []


def get_runtime_paths() -> RuntimePaths:
    """Prefer app-managed binaries; package-manager binaries are a fallback."""
    managed_bin = VYACT_RUNTIME_DIR / "bin"
    llama_server = managed_bin / _executable_name("llama-server")
    llama_swap = managed_bin / _executable_name("llama-swap")
    return RuntimePaths(
        llama_server=managed_executable("llama.cpp") or (_bundled_linux_executable("llama-server") or (llama_server if llama_server.exists() else _which_path("llama-server"))),
        llama_swap=managed_executable("llama-swap") or (_bundled_linux_executable("llama-swap") or (llama_swap if llama_swap.exists() else _which_path("llama-swap"))),
        models_dir=get_models_dir(),
        config_file=VYACT_SWAP_CONFIG,
    )


def _bundled_linux_executable(name: str) -> Path | None:
    if platform.system() != "Linux":
        return None
    executable = Path(__file__).resolve().parents[2] / "linux-runtime" / name
    return executable if executable.is_file() and os.access(executable, os.X_OK) else None


def runtime_is_available() -> bool:
    paths = get_runtime_paths()
    return bool(paths.llama_server and paths.llama_swap)


@protected("installation")
async def install_missing_runtime():
    """Install missing components from the release manifest, never from latest."""
    missing = [component for component, executable in (
        ("llama.cpp", managed_executable("llama.cpp") or _bundled_linux_executable("llama-server")),
        ("llama-swap", managed_executable("llama-swap") or _bundled_linux_executable("llama-swap")),
    ) if not executable]
    if not missing:
        yield "Existing llama.cpp and llama-swap installation detected"
        return
    yield ", ".join(missing)
    await install_pinned_components(missing)
    if not runtime_is_available():
        raise RuntimeError("Runtime installation completed but executables were not found")
    yield "Vyact native runtime ready"


def _which_path(name: str) -> Path | None:
    resolved = shutil.which(name)
    if resolved:
        return Path(resolved)
    return next((path for path in _known_executable_paths(name) if path.is_file()), None)


def get_host_memory_gb() -> int | None:
    """Return physical memory rounded down to GiB without adding a dependency."""
    try:
        if platform.system() == "Darwin":
            return int(subprocess.check_output(["sysctl", "-n", "hw.memsize"], text=True)) // (1024 ** 3)
        if platform.system() == "Linux":
            for line in Path("/proc/meminfo").read_text().splitlines():
                if line.startswith("MemTotal:"):
                    return int(line.split()[1]) // (1024 ** 2)
        if platform.system() == "Windows":
            output = subprocess.check_output(
                ["wmic", "computersystem", "get", "TotalPhysicalMemory", "/value"], text=True,
            )
            value = output.split("=", 1)[1].strip()
            return int(value) // (1024 ** 3)
    except (OSError, subprocess.SubprocessError, ValueError, IndexError):
        return None
    return None


def _model_key(model_path: Path) -> str:
    """Keep arbitrary Hugging Face file names out of YAML keys and shell text."""
    return f"vyact-{hashlib.sha256(str(model_path).encode()).hexdigest()[:16]}"


def initialize_downloaded_models_cache(*, force: bool = False) -> list[str]:
    """Scan managed GGUF files once and retain the result in process memory."""
    global _downloaded_models_cache
    with _downloaded_models_lock:
        if _downloaded_models_cache is not None and not force:
            return sorted(_downloaded_models_cache)
        models = {
            path.relative_to(get_models_dir()).as_posix()
            for path in get_models_dir().rglob("*.gguf")
            if path.is_file() and not path.name.endswith(".part")
        } if get_models_dir().is_dir() else set()
        _downloaded_models_cache = frozenset(models)
        return sorted(models)


def list_downloaded_models() -> list[str]:
    """Return the cached GGUF inventory without rescanning the filesystem."""
    return initialize_downloaded_models_cache()


def list_selectable_models() -> list[str]:
    """Return user-selectable models without internal MTP sidecar files."""
    return [
        model for model in list_downloaded_models()
        if PurePosixPath(model).parts[:1] != ("embeddings",)
        and not PurePosixPath(model).name.lower().startswith("mtp-")
        and not PurePosixPath(model).name.lower().startswith("mmproj")
        and "dflash2" not in PurePosixPath(model).name.lower()
    ]


def cache_downloaded_model(relative_path: str) -> None:
    """Record a completed managed download without rescanning model storage."""
    global _downloaded_models_cache
    with _downloaded_models_lock:
        current = set(_downloaded_models_cache or initialize_downloaded_models_cache())
        current.add(relative_path)
        _downloaded_models_cache = frozenset(current)


def uncache_downloaded_model(relative_path: str) -> None:
    """Remove a model from the inventory when a managed deletion succeeds."""
    global _downloaded_models_cache
    with _downloaded_models_lock:
        current = set(_downloaded_models_cache or initialize_downloaded_models_cache())
        current.discard(relative_path)
        _downloaded_models_cache = frozenset(current)


@protected("saving")
def delete_downloaded_model(relative_path: str) -> None:
    """Delete one validated, non-active GGUF model from managed storage."""
    model_path = get_downloaded_model_path(relative_path)
    dflash2_path = get_cached_dflash2_model(model_path)
    mapping_path = model_path.with_suffix(model_path.suffix + ".dflash2.json")
    model_path.unlink()
    mapping_path.unlink(missing_ok=True)
    uncache_downloaded_model(relative_path)
    if dflash2_path is None:
        return
    is_still_referenced = any(
        get_cached_dflash2_model(get_downloaded_model_path(candidate)) == dflash2_path
        for candidate in list_selectable_models()
    )
    if not is_still_referenced:
        companion_relative_path = dflash2_path.relative_to(get_models_dir()).as_posix()
        dflash2_path.unlink(missing_ok=True)
        uncache_downloaded_model(companion_relative_path)


def get_downloaded_model_path(relative_path: str) -> Path:
    candidate = (get_models_dir() / relative_path).resolve()
    models_dir = get_models_dir().resolve()
    if models_dir not in candidate.parents or candidate.suffix.lower() != ".gguf" or not candidate.is_file():
        raise LocalModelNotDownloadedError("The selected Vyact model is not a downloaded GGUF file")
    return candidate


def get_cached_mtp_sidecar(model_path: Path) -> Path | None:
    """Find a downloaded MTP sidecar from the same managed repository."""
    try:
        relative_model = model_path.resolve().relative_to(get_models_dir().resolve())
    except ValueError:
        return None
    if len(relative_model.parts) < 3:
        return None
    repository_prefix = "/".join(relative_model.parts[:2]) + "/"
    candidates = [
        relative_path for relative_path in list_downloaded_models()
        if relative_path.startswith(repository_prefix)
        and PurePosixPath(relative_path).name.lower().startswith("mtp-")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda path: (0 if "q4_0" in path.lower() else 1 if "q8_0" in path.lower() else 2, path))
    return get_downloaded_model_path(candidates[0])


@protected("saving")
def associate_dflash2_model(model_path: Path, dflash2_path: Path) -> None:
    relative_dflash2 = dflash2_path.resolve().relative_to(get_models_dir().resolve()).as_posix()
    mapping_path = model_path.with_suffix(model_path.suffix + ".dflash2.json")
    mapping_path.write_text(json.dumps({"model_path": relative_dflash2}), encoding="utf-8")


def get_cached_dflash2_model(model_path: Path) -> Path | None:
    mapping_path = model_path.with_suffix(model_path.suffix + ".dflash2.json")
    try:
        value = json.loads(mapping_path.read_text(encoding="utf-8"))
        return get_downloaded_model_path(str(value["model_path"]))
    except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError):
        return None


def get_cached_vision_projector(model_path: Path) -> Path | None:
    """Find a downloaded llama.cpp vision projector from the same repository."""
    try:
        relative_model = model_path.resolve().relative_to(get_models_dir().resolve())
    except ValueError:
        return None
    if len(relative_model.parts) < 3:
        return None
    repository_prefix = "/".join(relative_model.parts[:2]) + "/"
    candidates = [
        relative_path for relative_path in list_downloaded_models()
        if relative_path.startswith(repository_prefix)
        and PurePosixPath(relative_path).name.lower().startswith("mmproj")
    ]
    if not candidates:
        return None
    candidates.sort(key=lambda path: (
        1 if "bf16" in path.lower() else 0 if "f16" in path.lower() else 2 if "q8" in path.lower() else 3,
        path,
    ))
    return get_downloaded_model_path(candidates[0])


def get_model_modalities(model_path: Path) -> list[str]:
    """Return modalities declared by the model's downloaded projector."""
    return get_projector_modalities(get_cached_vision_projector(model_path))


def list_multimodal_supported_models() -> dict[str, list[str]]:
    """Return metadata-backed modality lists for installed GGUF models."""
    result = {"image": [], "audio": []}
    for relative_path in list_selectable_models():
        modalities = get_model_modalities(get_downloaded_model_path(relative_path))
        for modality in result:
            if modality in modalities:
                result[modality].append(relative_path)
    return result


def model_has_integrated_mtp(model_path: Path) -> bool:
    """Enable integrated MTP only when llama.cpp reports NextN/MTP tensors."""
    try:
        stat = model_path.stat()
    except OSError:
        return False
    cache_key = (str(model_path.resolve()), stat.st_size, stat.st_mtime_ns)
    cached = _integrated_mtp_cache.get(cache_key)
    if cached is not None:
        return cached

    paths = get_runtime_paths()
    if not paths.llama_server:
        _integrated_mtp_cache[cache_key] = False
        return False
    inspector = paths.llama_server.with_name(_executable_name("llama-gguf"))
    if not inspector.is_file():
        resolved = _which_path("llama-gguf")
        if not resolved:
            _integrated_mtp_cache[cache_key] = False
            return False
        inspector = resolved
    try:
        result = subprocess.run(
            [str(inspector), str(model_path), "r", "n"],
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            timeout=20,
            check=False,
        )
    except (OSError, subprocess.SubprocessError):
        _integrated_mtp_cache[cache_key] = False
        return False
    output = result.stdout.lower()
    supported = result.returncode == 0 and (b"nextn" in output or b"mtp" in output)
    _integrated_mtp_cache[cache_key] = supported
    return supported


def list_mtp_supported_models() -> list[str]:
    """Return cached MTP support without inspecting model files on list requests.

    Sidecar discovery uses the in-memory download inventory. Integrated MTP is
    reported only after activation has already populated its stat-keyed cache.
    This keeps model list and search endpoints fast regardless of model size.
    """
    supported = []
    for relative_path in list_selectable_models():
        try:
            model_path = get_downloaded_model_path(relative_path)
            stat = model_path.stat()
            cache_key = (str(model_path.resolve()), stat.st_size, stat.st_mtime_ns)
            if get_cached_mtp_sidecar(model_path) or _integrated_mtp_cache.get(cache_key) is True:
                supported.append(relative_path)
        except (OSError, ValueError):
            continue
    return supported


def list_dflash2_supported_models() -> list[str]:
    return [
        relative_path for relative_path in list_selectable_models()
        if get_cached_dflash2_model(get_downloaded_model_path(relative_path)) is not None
    ]


def get_active_mtp_model() -> str | None:
    return _active_mtp_model


def get_active_dflash2_model() -> str | None:
    return _active_dflash2_model


def _read_owned_pid() -> int | None:
    try:
        return int(VYACT_RUNTIME_PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _is_llama_swap_process(pid: int) -> bool:
    try:
        command = psutil.Process(pid).cmdline()
    except psutil.NoSuchProcess:
        return False
    except psutil.AccessDenied as error:
        raise RuntimeError("Unable to inspect the existing Vyact runtime") from error
    if not command or command[0].replace("\\", "/").rsplit("/", 1)[-1].lower() not in {"llama-swap", "llama-swap.exe"}:
        return False
    config = None
    for index, argument in enumerate(command):
        if argument in {"--config", "-config"} and index + 1 < len(command):
            config = command[index + 1]
        elif argument.startswith(("--config=", "-config=")):
            config = argument.split("=", 1)[1]
    return bool(config and os.path.normcase(os.path.abspath(config)) == os.path.normcase(os.path.abspath(VYACT_SWAP_CONFIG)))


def _process_has_exited(pid: int) -> bool:
    if _runtime_process is not None and _runtime_process.pid == pid:
        return _runtime_process.poll() is not None
    try:
        process = psutil.Process(pid)
        return not process.is_running() or process.status() == psutil.STATUS_ZOMBIE
    except psutil.NoSuchProcess:
        return True
    except psutil.AccessDenied as error:
        raise RuntimeError("Unable to inspect the existing Vyact runtime") from error


@protected("runtime")
def stop_runtime() -> None:
    """Stop only the llama-swap process recorded by Vyact.

    The PID file is app-owned and the target is validated as alive before a
    signal is sent. Failure to stop is surfaced to the caller instead of
    starting a second server on the same local port.
    """
    global _active_dflash2_model, _active_mtp_model, _runtime_process
    _active_mtp_model = None
    _active_dflash2_model = None
    pid = _read_owned_pid()
    if pid is None:
        return
    if _process_has_exited(pid):
        if _runtime_process is not None and _runtime_process.pid == pid:
            _runtime_process.wait()
            _runtime_process = None
        VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
        return
    if not _is_llama_swap_process(pid):
        VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
        raise RuntimeError("Vyact runtime PID no longer refers to llama-swap")
    try:
        if os.name == "nt":
            # Windows terminate does not cascade to llama-server children.
            parent = psutil.Process(pid)
            for child in reversed(parent.children(recursive=True)):
                try:
                    child.terminate()
                    child.wait(timeout=10)
                except psutil.NoSuchProcess:
                    pass
            parent.terminate()
        elif _runtime_process is not None and _runtime_process.pid == pid:
            _runtime_process.terminate()
        else:
            psutil.Process(pid).terminate()
    except psutil.NoSuchProcess:
        pass
    except (OSError, psutil.Error) as error:
        raise RuntimeError("Unable to stop the existing Vyact runtime") from error
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        if _process_has_exited(pid):
            if _runtime_process is not None and _runtime_process.pid == pid:
                try:
                    _runtime_process.wait(timeout=0)
                except subprocess.TimeoutExpired:
                    pass
                _runtime_process = None
            VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
            return
        time.sleep(0.1)
    raise RuntimeError("The existing Vyact runtime did not stop in time")


@with_runtime_ports
def start_single_model(
        model_path: Path, context_size: int, debug_logging: bool = False,
        cache_quantization: bool = True, enable_mtp: bool | None = None,
        kv_cache_precision: str | None = None, performance_mode: str = "auto",
        cpu_threads: int | None = None, gpu_split_percentages: list[float] | None = None,
        gpu_manual_split_enabled: bool = False,
        runtime_status: dict | None = None,
) -> str:
    """Restart llama-swap with exactly one configured model and return its API ID."""
    global _active_dflash2_model, _active_mtp_model, _runtime_process
    kv_cache_precision = kv_cache_precision or ("q8" if cache_quantization else "none")
    if gpu_manual_split_enabled and gpu_split_percentages:
        validated_gpu_split = validate_gpu_split_percentages(
            gpu_split_percentages, get_local_hardware_info(),
        )
        if not validated_gpu_split:
            raise ValueError("invalid_gpu_split_percentages")
        gpu_split_percentages = validated_gpu_split
    elif gpu_manual_split_enabled:
        raise ValueError("invalid_gpu_split_percentages")
    else:
        gpu_split_percentages = None
    dflash2_model_path = get_cached_dflash2_model(model_path)
    if dflash2_model_path is None and enable_mtp is True and kv_cache_precision != "none":
        raise ValueError("MTP acceleration and KV cache quantization cannot be enabled together")
    logger.info("[llama] loading model=%s context=%s mtp=%s kv=%s performance=%s threads=%s gpu_split=%s manual=%s",
                model_path, context_size, enable_mtp, kv_cache_precision, performance_mode,
                cpu_threads, gpu_split_percentages, gpu_manual_split_enabled)
    paths = get_runtime_paths()
    if not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")
    from services.mlx_runtime import stop_mlx_runtime

    stop_mlx_runtime()
    mtp_model_path = get_cached_mtp_sidecar(model_path)
    vision_projector_path = get_cached_vision_projector(model_path)
    log_path = get_log_file("llama-swap")
    log_start = 0

    @protected("runtime")
    def launch(acceleration: str | None) -> tuple[str, subprocess.Popen]:
        nonlocal log_start
        global _runtime_process
        stop_runtime()
        log_start = log_path.stat().st_size if log_path.exists() else 0
        model_key = write_single_model_config(
            model_path, context_size, mtp_model_path if acceleration == "mtp" else None,
            vision_projector_path=vision_projector_path,
            enable_mtp=acceleration == "mtp", dflash2_model_path=dflash2_model_path if acceleration == "dflash2" else None,
            debug_logging=debug_logging, cache_quantization=cache_quantization and acceleration is None,
            kv_cache_precision="none" if acceleration else kv_cache_precision,
            performance_mode=performance_mode, cpu_threads=cpu_threads,
            gpu_split_percentages=gpu_split_percentages,
        )
        VYACT_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        process = start_logged_process(
            [str(paths.llama_swap), "--config", str(VYACT_SWAP_CONFIG), "--listen", f"127.0.0.1:{get_runtime_port()}"],
            "llama-swap", start_new_session=True,
            env=runtime_environment(paths.llama_server or paths.llama_swap),
        )
        _runtime_process = process
        VYACT_RUNTIME_PID_FILE.write_text(str(process.pid), encoding="utf-8")
        return model_key, process

    def wait_until_loaded(model_key: str, process: subprocess.Popen) -> None:
        deadline = time.monotonic() + 120
        health_url = f"http://127.0.0.1:{get_runtime_port()}/upstream/{model_key}/health"
        while time.monotonic() < deadline:
            if process.poll() is not None:
                wait_for_process_log(process)
                raise runtime_startup_error("llama-swap stopped while loading the model", log_path, since=log_start)
            try:
                with urllib.request.urlopen(health_url, timeout=2) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.25)
        raise runtime_startup_error("The model did not become ready within 120 seconds", log_path, since=log_start)

    supports_mtp = mtp_model_path is not None or model_has_integrated_mtp(model_path)
    should_try_mtp = supports_mtp and enable_mtp is not False
    acceleration = "dflash2" if dflash2_model_path is not None else "mtp" if should_try_mtp else None
    model_key, process = launch(acceleration)
    try:
        wait_until_loaded(model_key, process)
        try:
            relative_model = str(model_path.resolve().relative_to(get_models_dir().resolve()))
        except ValueError:
            relative_model = str(model_path)
        _active_dflash2_model = relative_model if acceleration == "dflash2" else None
        _active_mtp_model = relative_model if acceleration == "mtp" else None
    except RuntimeError as error:
        logger.exception("[llama] load failed model=%s acceleration=%s context=%s", model_path, acceleration, context_size)
        if acceleration is None or is_port_conflict(error):
            raise
        if runtime_status is not None and acceleration == "mtp":
            failure_code, failure_message = classify_runtime_load_failure(error)
            runtime_status.update({
                "mtp_fallback": True,
                "mtp_failure_code": failure_code,
                "mtp_failure_message": failure_message,
            })
        logger.warning("[llama] retrying without acceleration model=%s", model_path)
        model_key, process = launch(None)
        wait_until_loaded(model_key, process)
        _active_mtp_model = None
        _active_dflash2_model = None
    return model_key


def start_configured_runtime(
        vyact_config: dict, debug_logging: bool = False, runtime_status: dict | None = None,
) -> str:
    """Restore the configured GGUF or MLX model after an app restart."""
    model_path_value = str(vyact_config.get("model_path") or "")
    if not model_path_value:
        raise ValueError("No Vyact model is configured")
    context_size = int(vyact_config.get("context_size", DEFAULT_CHAT_CONTEXT_SIZE))
    if context_size < MINIMUM_SUPPORTED_CHAT_CONTEXT_SIZE:
        context_size = DEFAULT_CHAT_CONTEXT_SIZE
        vyact_config["context_size"] = context_size
    if vyact_config.get("runtime", "gguf") == "mlx":
        from services.mlx_runtime import get_downloaded_mlx_model_path, start_mlx_model
        return start_mlx_model(
            get_downloaded_mlx_model_path(model_path_value), context_size, debug_logging,
            bool(vyact_config.get("cache_quantization", True)), vyact_config.get("mtp_enabled"),
            vyact_config.get("kv_cache_precision"), vyact_config.get("performance_mode", "auto"),
            vyact_config.get("cpu_threads"), runtime_status,
        )
    aligned_config = normalize_gpu_split_for_hardware(vyact_config, get_local_hardware_info())
    vyact_config.update({
        "gpu_split_percentages": aligned_config["gpu_split_percentages"],
        "gpu_manual_split_enabled": aligned_config["gpu_manual_split_enabled"],
    })
    vyact_config.pop("gpu_memory_allocations", None)
    model_key = start_single_model(
        get_downloaded_model_path(model_path_value), context_size, debug_logging,
        bool(vyact_config.get("cache_quantization", True)), vyact_config.get("mtp_enabled"),
        vyact_config.get("kv_cache_precision"), vyact_config.get("performance_mode", "auto"),
        vyact_config.get("cpu_threads"), vyact_config.get("gpu_split_percentages"),
        bool(vyact_config.get("gpu_manual_split_enabled", False)),
        runtime_status,
    )
    vyact_config["context_size"] = get_loaded_context_size(model_key, context_size)
    return model_key


def get_loaded_context_size(model_key: str, fallback: int) -> int:
    """Read llama.cpp's effective context after automatic fit adjustments."""
    props_url = f"http://127.0.0.1:{get_runtime_port()}/upstream/{quote(model_key, safe='')}/props"
    try:
        with urllib.request.urlopen(props_url, timeout=5) as response:
            props = json.load(response)
        settings = props.get("default_generation_settings", {})
        value = int(settings.get("n_ctx") or 0)
        return value if value >= 512 else fallback
    except (OSError, TypeError, ValueError, urllib.error.URLError):
        return fallback


def stop_all_vyact_runtimes() -> None:
    from services.mlx_runtime import stop_mlx_runtime
    stop_runtime()
    stop_mlx_runtime()


@protected("saving")
def write_single_model_config(
        model_path: Path, context_size: int, mtp_model_path: Path | None = None,
        vision_projector_path: Path | None = None, *,
        dflash2_model_path: Path | None = None,
        enable_mtp: bool = True, debug_logging: bool = False, cache_quantization: bool = True,
        kv_cache_precision: str | None = None, performance_mode: str = "auto",
        cpu_threads: int | None = None, gpu_split_percentages: list[float] | None = None,
) -> str:
    """Write a llama-swap config that can only load the selected model.

    Replacing the config before restart is intentional: it prevents an old
    model configuration from keeping memory occupied on a local machine.
    """
    if model_path.suffix.lower() != ".gguf" or not model_path.is_file():
        raise ValueError("A downloaded GGUF model file is required")
    if context_size < 512:
        raise ValueError("Context size must be at least 512")
    if mtp_model_path is not None and (
        mtp_model_path.suffix.lower() != ".gguf"
        or not mtp_model_path.is_file()
        or not mtp_model_path.name.lower().startswith("mtp-")
    ):
        raise ValueError("A compatible downloaded MTP sidecar is required")
    if vision_projector_path is not None and (
        vision_projector_path.suffix.lower() != ".gguf"
        or not vision_projector_path.is_file()
        or not vision_projector_path.name.lower().startswith("mmproj")
    ):
        raise ValueError("A compatible downloaded vision projector is required")
    if dflash2_model_path is not None and (
        dflash2_model_path.suffix.lower() != ".gguf" or not dflash2_model_path.is_file()
        or "dflash2" not in dflash2_model_path.name.lower()
    ):
        raise ValueError("A compatible downloaded DFlash2 draft model is required")
    paths = get_runtime_paths()
    if not paths.llama_server or not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")

    VYACT_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    get_models_dir().mkdir(parents=True, exist_ok=True)
    model_key = _model_key(model_path)
    uses_integrated_mtp = enable_mtp and mtp_model_path is None and model_has_integrated_mtp(model_path)
    uses_mtp = mtp_model_path is not None or uses_integrated_mtp
    kv_cache_precision = kv_cache_precision or ("q8" if cache_quantization else "none")
    batch_size, ubatch_size = {
        "memory": (512, 128),
        "performance": (4096, 1024),
    }.get(performance_mode, (LLAMA_BATCH_SIZE, LLAMA_UBATCH_SIZE))
    command = " ".join([
        json.dumps(str(paths.llama_server)),
        "--host", "127.0.0.1", "--port", "${PORT}", "--model", json.dumps(str(model_path)),
        "--ctx-size", str(context_size), "--jinja", "--n-gpu-layers", "auto",
        "--batch-size", str(batch_size), "--ubatch-size", str(ubatch_size),
        "--parallel", "1",
        "--flash-attn", "auto", "--cache-prompt",
    ])
    gpu_split_percentages = [
        round(float(value), GPU_SPLIT_DECIMAL_PLACES)
        for value in (gpu_split_percentages or [])
    ]
    if len(gpu_split_percentages) >= 2 and any(value > 0 for value in gpu_split_percentages):
        tensor_split = ",".join(f"{value:g}" for value in gpu_split_percentages)
        command += f" --split-mode layer --tensor-split {tensor_split} --fit off"
    else:
        command += " --fit on"
    if kv_cache_precision != "none" and not uses_mtp and dflash2_model_path is None:
        cache_type = "q4_0" if kv_cache_precision == "q4" else "q8_0"
        command += f" --cache-type-k {cache_type} --cache-type-v {cache_type}"
    if cpu_threads is not None:
        command += f" --threads {cpu_threads} --threads-batch {cpu_threads}"
    if debug_logging:
        command += " --log-verbosity 4 --log-timestamps"
    if vision_projector_path is not None:
        command += f" --mmproj {json.dumps(str(vision_projector_path))}"
    if dflash2_model_path is not None:
        command += " " + " ".join([
            "--spec-draft-model", json.dumps(str(dflash2_model_path)),
            "--spec-draft-ngl", "auto", "--spec-type", "draft-dflash", "--spec-draft-n-max", "6",
        ])
    elif mtp_model_path is not None:
        command += " " + " ".join([
            "--spec-draft-model", json.dumps(str(mtp_model_path)),
            "--spec-draft-ngl", "auto",
            "--spec-type", "draft-mtp",
            "--spec-draft-n-max", "3",
        ])
    elif uses_integrated_mtp:
        command += " --spec-type draft-mtp --spec-draft-n-max 3"
    config = "\n".join([
        "# Generated by Vyact. Do not add models here: one model is kept resident.",
        f"startPort: {get_model_port()}",
        'logToStdout: "both"',
        "models:",
        f"  {json.dumps(model_key)}:",
        f"    cmd: {json.dumps(command)}",
        "    ttl: 0",
        "",
    ])
    VYACT_SWAP_CONFIG.write_text(config, encoding="utf-8")
    return model_key
