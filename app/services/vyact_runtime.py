"""Native llama.cpp + llama-swap runtime paths and configuration.

The desktop product deliberately does not use Docker for its default local
runtime.  In particular, a macOS container cannot use llama.cpp's Metal
backend, while a native llama-server can.
"""
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
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from config import INSTALL_DIR

VYACT_RUNTIME_PORT = 11435
VYACT_RUNTIME_URL = f"http://127.0.0.1:{VYACT_RUNTIME_PORT}/v1"
VYACT_RUNTIME_DIR = INSTALL_DIR / "runtime"
VYACT_MODELS_DIR = INSTALL_DIR / "models"
VYACT_SWAP_CONFIG = VYACT_RUNTIME_DIR / "llama-swap.yaml"
VYACT_RUNTIME_PID_FILE = VYACT_RUNTIME_DIR / "llama-swap.pid"

_downloaded_models_lock = threading.RLock()
_downloaded_models_cache: frozenset[str] | None = None
_integrated_mtp_cache: dict[tuple[str, int, int], bool] = {}
_active_mtp_model: str | None = None


@dataclass(frozen=True)
class RuntimePaths:
    """Resolved executable and storage paths for the native local runtime."""

    llama_server: Path | None
    llama_swap: Path | None
    models_dir: Path
    config_file: Path


def _executable_name(name: str) -> str:
    return f"{name}.exe" if os.name == "nt" else name


def get_runtime_paths() -> RuntimePaths:
    """Prefer app-managed binaries; package-manager binaries are a fallback."""
    managed_bin = VYACT_RUNTIME_DIR / "bin"
    llama_server = managed_bin / _executable_name("llama-server")
    llama_swap = managed_bin / _executable_name("llama-swap")
    return RuntimePaths(
        llama_server=llama_server if llama_server.exists() else _which_path("llama-server"),
        llama_swap=llama_swap if llama_swap.exists() else _which_path("llama-swap"),
        models_dir=VYACT_MODELS_DIR,
        config_file=VYACT_SWAP_CONFIG,
    )


def runtime_is_available() -> bool:
    paths = get_runtime_paths()
    return bool(paths.llama_server and paths.llama_swap)


def get_native_install_commands() -> list[list[str]]:
    """Return non-interactive package-manager commands for a missing runtime.

    This never upgrades or removes an existing system installation.  The caller
    must check :func:`runtime_is_available` first.
    """
    paths = get_runtime_paths()
    system = platform.system()
    if system in {"Darwin", "Linux"} and shutil.which("brew"):
        commands = []
        if not paths.llama_server:
            commands.append(["brew", "install", "llama.cpp"])
        if not paths.llama_swap:
            commands.extend([
                ["brew", "tap", "mostlygeek/llama-swap"],
                ["brew", "trust", "--formula", "mostlygeek/llama-swap/llama-swap"],
                ["brew", "install", "mostlygeek/llama-swap/llama-swap"],
            ])
        return commands
    if system == "Windows" and shutil.which("winget"):
        common = ["--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]
        commands = []
        if not paths.llama_server:
            commands.append(["winget", "install", "--id", "ggml.llamacpp", *common])
        if not paths.llama_swap:
            commands.append(["winget", "install", "--id", "mostlygeek.llama-swap", *common])
        return commands
    return []


def get_native_update_commands() -> list[list[str]]:
    """Return explicit update commands for the detected package-manager source.

    Updates are deliberately opt-in. A new llama.cpp build can alter templates
    or tool-call parsing, so starting the app must never update it implicitly.
    """
    system = platform.system()
    if system in {"Darwin", "Linux"} and shutil.which("brew"):
        return [["brew", "upgrade", "llama.cpp", "llama-swap"]]
    if system == "Windows" and shutil.which("winget"):
        common = ["--exact", "--accept-package-agreements", "--accept-source-agreements", "--disable-interactivity"]
        return [
            ["winget", "upgrade", "--id", "ggml.llamacpp", *common],
            ["winget", "upgrade", "--id", "mostlygeek.llama-swap", *common],
        ]
    return []


async def install_missing_runtime():
    """Install only absent components, yielding user-visible command progress."""
    if runtime_is_available():
        yield "Existing llama.cpp and llama-swap installation detected"
        return
    commands = get_native_install_commands()
    if not commands:
        raise RuntimeError("No supported package manager was found for automatic runtime installation")
    for command in commands:
        package_name = command[command.index("--id") + 1] if "--id" in command else command[-1]
        yield f"Installing {package_name}..."
        process = await asyncio.create_subprocess_exec(
            *command,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )
        stdout, _ = await process.communicate()
        if process.returncode != 0:
            output_lines = stdout.decode("utf-8", errors="replace").strip().splitlines()
            detail = output_lines[-1] if output_lines else "unknown package manager error"
            raise RuntimeError(f"Runtime installation failed: {' '.join(command)}: {detail}")
    if not runtime_is_available():
        raise RuntimeError("Runtime installation completed but executables were not found in PATH")
    yield "Vyact native runtime ready"


def _which_path(name: str) -> Path | None:
    resolved = shutil.which(name)
    return Path(resolved) if resolved else None


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
            path.relative_to(VYACT_MODELS_DIR).as_posix()
            for path in VYACT_MODELS_DIR.rglob("*.gguf")
            if path.is_file() and not path.name.endswith(".part")
        } if VYACT_MODELS_DIR.is_dir() else set()
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


def get_downloaded_model_path(relative_path: str) -> Path:
    candidate = (VYACT_MODELS_DIR / relative_path).resolve()
    models_dir = VYACT_MODELS_DIR.resolve()
    if models_dir not in candidate.parents or candidate.suffix.lower() != ".gguf" or not candidate.is_file():
        raise ValueError("The selected Vyact model is not a downloaded GGUF file")
    return candidate


def get_cached_mtp_sidecar(model_path: Path) -> Path | None:
    """Find a downloaded MTP sidecar from the same managed repository."""
    try:
        relative_model = model_path.resolve().relative_to(VYACT_MODELS_DIR.resolve())
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


def get_cached_vision_projector(model_path: Path) -> Path | None:
    """Find a downloaded llama.cpp vision projector from the same repository."""
    try:
        relative_model = model_path.resolve().relative_to(VYACT_MODELS_DIR.resolve())
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


def get_active_mtp_model() -> str | None:
    return _active_mtp_model


def _read_owned_pid() -> int | None:
    try:
        return int(VYACT_RUNTIME_PID_FILE.read_text(encoding="utf-8").strip())
    except (OSError, ValueError):
        return None


def _is_llama_swap_process(pid: int) -> bool:
    try:
        if os.name == "nt":
            output = subprocess.check_output(
                ["wmic", "process", "where", f"ProcessId={pid}", "get", "CommandLine", "/value"], text=True,
            )
        else:
            output = subprocess.check_output(["ps", "-p", str(pid), "-o", "command="], text=True)
    except (OSError, subprocess.SubprocessError):
        return False
    return "llama-swap" in output.lower()


def stop_runtime() -> None:
    """Stop only the llama-swap process recorded by Vyact.

    The PID file is app-owned and the target is validated as alive before a
    signal is sent. Failure to stop is surfaced to the caller instead of
    starting a second server on the same local port.
    """
    global _active_mtp_model
    _active_mtp_model = None
    pid = _read_owned_pid()
    if pid is None:
        return
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
        return
    if not _is_llama_swap_process(pid):
        VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
        raise RuntimeError("Vyact runtime PID no longer refers to llama-swap")
    try:
        os.kill(pid, signal.SIGTERM)
    except OSError as error:
        raise RuntimeError("Unable to stop the existing Vyact runtime") from error
    deadline = time.monotonic() + 10
    while time.monotonic() < deadline:
        try:
            os.kill(pid, 0)
        except ProcessLookupError:
            VYACT_RUNTIME_PID_FILE.unlink(missing_ok=True)
            return
        time.sleep(0.1)
    raise RuntimeError("The existing Vyact runtime did not stop in time")


def start_single_model(model_path: Path, context_size: int, debug_logging: bool = False) -> str:
    """Restart llama-swap with exactly one configured model and return its API ID."""
    global _active_mtp_model
    paths = get_runtime_paths()
    if not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")
    from services.mlx_runtime import stop_mlx_runtime

    stop_mlx_runtime()
    mtp_model_path = get_cached_mtp_sidecar(model_path)
    vision_projector_path = get_cached_vision_projector(model_path)

    def launch(enable_mtp: bool) -> tuple[str, subprocess.Popen]:
        stop_runtime()
        model_key = write_single_model_config(
            model_path, context_size, mtp_model_path if enable_mtp else None,
            vision_projector_path=vision_projector_path,
            enable_mtp=enable_mtp, debug_logging=debug_logging,
        )
        VYACT_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
        log_path = VYACT_RUNTIME_DIR / "llama-swap.log"
        with log_path.open("ab") as log_file:
            process = subprocess.Popen(
                [str(paths.llama_swap), "--config", str(VYACT_SWAP_CONFIG), "--listen", f"127.0.0.1:{VYACT_RUNTIME_PORT}"],
                stdout=log_file,
                stderr=subprocess.STDOUT,
                start_new_session=True,
            )
        VYACT_RUNTIME_PID_FILE.write_text(str(process.pid), encoding="utf-8")
        return model_key, process

    def wait_until_loaded(model_key: str, process: subprocess.Popen) -> None:
        deadline = time.monotonic() + 120
        health_url = f"http://127.0.0.1:{VYACT_RUNTIME_PORT}/upstream/{model_key}/health"
        while time.monotonic() < deadline:
            if process.poll() is not None:
                raise RuntimeError("llama-swap stopped while loading the model")
            try:
                with urllib.request.urlopen(health_url, timeout=2) as response:
                    if response.status == 200:
                        return
            except (OSError, urllib.error.URLError):
                pass
            time.sleep(0.25)
        raise RuntimeError("The model did not become ready within 120 seconds")

    should_try_mtp = mtp_model_path is not None or model_has_integrated_mtp(model_path)
    model_key, process = launch(should_try_mtp)
    try:
        wait_until_loaded(model_key, process)
        _active_mtp_model = str(model_path.resolve().relative_to(VYACT_MODELS_DIR.resolve())) if should_try_mtp else None
    except RuntimeError:
        if not should_try_mtp:
            raise
        model_key, process = launch(False)
        wait_until_loaded(model_key, process)
        _active_mtp_model = None
    return model_key


def start_configured_runtime(vyact_config: dict, debug_logging: bool = False) -> str:
    """Restore the configured GGUF or MLX model after an app restart."""
    model_path_value = str(vyact_config.get("model_path") or "")
    if not model_path_value:
        raise ValueError("No Vyact model is configured")
    context_size = int(vyact_config.get("context_size", 32768))
    if vyact_config.get("runtime", "gguf") == "mlx":
        from services.mlx_runtime import get_downloaded_mlx_model_path, start_mlx_model
        return start_mlx_model(get_downloaded_mlx_model_path(model_path_value), context_size, debug_logging)
    return start_single_model(get_downloaded_model_path(model_path_value), context_size, debug_logging)


def stop_all_vyact_runtimes() -> None:
    from services.mlx_runtime import stop_mlx_runtime
    stop_runtime()
    stop_mlx_runtime()


def write_single_model_config(
        model_path: Path, context_size: int, mtp_model_path: Path | None = None,
        vision_projector_path: Path | None = None, *,
        enable_mtp: bool = True, debug_logging: bool = False,
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
    paths = get_runtime_paths()
    if not paths.llama_server or not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")

    VYACT_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    VYACT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_key = _model_key(model_path)
    command = " ".join([
        json.dumps(str(paths.llama_server)),
        "--host", "127.0.0.1", "--port", "${PORT}", "--model", json.dumps(str(model_path)),
        "--ctx-size", str(context_size), "--jinja", "--n-gpu-layers", "auto",
        "--fit", "on", "--flash-attn", "auto",
    ])
    if debug_logging:
        command += " --log-verbosity 4 --log-timestamps"
    if vision_projector_path is not None:
        command += f" --mmproj {json.dumps(str(vision_projector_path))}"
    if mtp_model_path is not None:
        command += " " + " ".join([
            "--spec-draft-model", json.dumps(str(mtp_model_path)),
            "--spec-draft-ngl", "auto",
            "--spec-type", "draft-mtp",
            "--spec-draft-n-max", "3",
        ])
    elif enable_mtp and model_has_integrated_mtp(model_path):
        command += " --spec-type draft-mtp --spec-draft-n-max 3"
    config = "\n".join([
        "# Generated by Vyact. Do not add models here: one model is kept resident.",
        "models:",
        f"  {json.dumps(model_key)}:",
        f"    cmd: {json.dumps(command)}",
        "    ttl: 0",
        "",
    ])
    VYACT_SWAP_CONFIG.write_text(config, encoding="utf-8")
    return model_key
