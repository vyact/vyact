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
import time
from dataclasses import dataclass
from pathlib import Path

from config import INSTALL_DIR

VYACT_RUNTIME_PORT = 11435
VYACT_RUNTIME_URL = f"http://127.0.0.1:{VYACT_RUNTIME_PORT}/v1"
VYACT_RUNTIME_DIR = INSTALL_DIR / "runtime"
VYACT_MODELS_DIR = INSTALL_DIR / "models"
VYACT_SWAP_CONFIG = VYACT_RUNTIME_DIR / "llama-swap.yaml"
VYACT_RUNTIME_PID_FILE = VYACT_RUNTIME_DIR / "llama-swap.pid"


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
                ["brew", "install", "llama-swap"],
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
        await process.communicate()
        if process.returncode != 0:
            raise RuntimeError(f"Runtime installation failed: {command[0]}")
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


def list_downloaded_models() -> list[str]:
    """Return complete GGUF files and ignore temporary download artifacts."""
    if not VYACT_MODELS_DIR.is_dir():
        return []
    return sorted(
        str(path.relative_to(VYACT_MODELS_DIR))
        for path in VYACT_MODELS_DIR.rglob("*.gguf")
        if path.is_file() and not path.name.endswith(".part")
    )


def get_downloaded_model_path(relative_path: str) -> Path:
    candidate = (VYACT_MODELS_DIR / relative_path).resolve()
    models_dir = VYACT_MODELS_DIR.resolve()
    if models_dir not in candidate.parents or candidate.suffix.lower() != ".gguf" or not candidate.is_file():
        raise ValueError("The selected Vyact model is not a downloaded GGUF file")
    return candidate


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


def start_single_model(model_path: Path, context_size: int) -> str:
    """Restart llama-swap with exactly one configured model and return its API ID."""
    paths = get_runtime_paths()
    if not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")
    stop_runtime()
    model_key = write_single_model_config(model_path, context_size)
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
    return model_key


def write_single_model_config(model_path: Path, context_size: int) -> str:
    """Write a llama-swap config that can only load the selected model.

    Replacing the config before restart is intentional: it prevents an old
    model configuration from keeping memory occupied on a local machine.
    """
    if model_path.suffix.lower() != ".gguf" or not model_path.is_file():
        raise ValueError("A downloaded GGUF model file is required")
    if context_size < 512:
        raise ValueError("Context size must be at least 512")
    paths = get_runtime_paths()
    if not paths.llama_server or not paths.llama_swap:
        raise RuntimeError("Vyact native runtime is not installed")

    VYACT_RUNTIME_DIR.mkdir(parents=True, exist_ok=True)
    VYACT_MODELS_DIR.mkdir(parents=True, exist_ok=True)
    model_key = _model_key(model_path)
    command = " ".join([
        json.dumps(str(paths.llama_server)),
        "--host", "127.0.0.1", "--port", "${PORT}", "--model", json.dumps(str(model_path)),
        "--ctx-size", str(context_size), "--jinja", "--n-gpu-layers", "99",
    ])
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
