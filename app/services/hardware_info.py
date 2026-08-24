"""Cross-platform memory and accelerator discovery for local model guidance."""
import json
import platform
import shutil
import subprocess

import psutil


COMMAND_TIMEOUT_SECONDS = 4
MIB = 1024 ** 2


def _run_command(command: list[str]) -> str:
    try:
        return subprocess.check_output(
            command,
            text=True,
            stderr=subprocess.DEVNULL,
            timeout=COMMAND_TIMEOUT_SECONDS,
        ).strip()
    except (OSError, subprocess.SubprocessError):
        return ""


def _nvidia_gpus() -> list[dict]:
    if not shutil.which("nvidia-smi"):
        return []
    output = _run_command([
        "nvidia-smi",
        "--query-gpu=name,memory.total,memory.free",
        "--format=csv,noheader,nounits",
    ])
    gpus = []
    for line in output.splitlines():
        parts = [part.strip() for part in line.split(",")]
        if len(parts) != 3:
            continue
        try:
            gpus.append({
                "name": parts[0], "backend": "CUDA",
                "total_bytes": int(parts[1]) * MIB,
                "available_bytes": int(parts[2]) * MIB,
                "shared_memory": False,
            })
        except ValueError:
            continue
    return gpus


def _rocm_gpus() -> list[dict]:
    if not shutil.which("rocm-smi"):
        return []
    raw = _run_command(["rocm-smi", "--showproductname", "--showmeminfo", "vram", "--json"])
    try:
        devices = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    gpus = []
    for device_name, values in devices.items():
        if not isinstance(values, dict):
            continue
        total = int(values.get("VRAM Total Memory (B)", 0) or 0)
        used = int(values.get("VRAM Total Used Memory (B)", 0) or 0)
        name = values.get("Card series") or values.get("Card model") or device_name
        gpus.append({
            "name": str(name), "backend": "ROCm", "total_bytes": total,
            "available_bytes": max(0, total - used), "shared_memory": False,
        })
    return gpus


def _windows_display_adapters() -> list[dict]:
    if platform.system() != "Windows" or not shutil.which("powershell"):
        return []
    raw = _run_command([
        "powershell", "-NoProfile", "-Command",
        "Get-CimInstance Win32_VideoController | Select-Object Name,AdapterRAM | ConvertTo-Json -Compress",
    ])
    try:
        adapters = json.loads(raw)
    except (TypeError, json.JSONDecodeError):
        return []
    if isinstance(adapters, dict):
        adapters = [adapters]
    return [{
        "name": str(adapter.get("Name") or "GPU"), "backend": "GPU",
        "total_bytes": int(adapter.get("AdapterRAM") or 0), "available_bytes": 0,
        "shared_memory": True,
    } for adapter in adapters if isinstance(adapter, dict)]


def _linux_display_adapters() -> list[dict]:
    if platform.system() != "Linux" or not shutil.which("lspci"):
        return []
    output = _run_command(["lspci"])
    names = [
        line.split(": ", 1)[-1]
        for line in output.splitlines()
        if "VGA compatible controller" in line or "3D controller" in line
    ]
    return [{
        "name": name, "backend": "GPU", "total_bytes": 0,
        "available_bytes": 0, "shared_memory": True,
    } for name in names]


def get_local_hardware_info() -> dict:
    memory = psutil.virtual_memory()
    is_apple_silicon = platform.system() == "Darwin" and platform.machine().lower() in {"arm64", "aarch64"}
    if is_apple_silicon:
        gpus = [{
            "name": "Apple Silicon GPU", "backend": "Metal",
            "total_bytes": memory.total, "available_bytes": memory.available,
            "shared_memory": True,
        }]
        memory_mode = "unified"
    else:
        gpus = _nvidia_gpus() or _rocm_gpus() or _windows_display_adapters() or _linux_display_adapters()
        memory_mode = "dedicated" if any(gpu["total_bytes"] and not gpu["shared_memory"] for gpu in gpus) else "system"
    return {
        "platform": platform.system().lower(),
        "apple_silicon": is_apple_silicon,
        "memory_mode": memory_mode,
        "system_memory": {"total_bytes": memory.total, "available_bytes": memory.available},
        "gpus": gpus,
    }
