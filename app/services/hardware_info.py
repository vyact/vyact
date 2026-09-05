"""Cross-platform memory and accelerator discovery for local model guidance."""
import copy
from functools import lru_cache
import ctypes
import json
import math
import platform
import shutil
import subprocess

import psutil


COMMAND_TIMEOUT_SECONDS = 4
MIB = 1024 ** 2
GPU_SPLIT_TOTAL_PERCENT = 100.0
GPU_SPLIT_DECIMAL_PLACES = 2
GPU_SPLIT_SUM_TOLERANCE = 0.005


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


METAL_FRAMEWORK_PATH = "/System/Library/Frameworks/Metal.framework/Metal"
OBJC_LIBRARY_PATH = "/usr/lib/libobjc.A.dylib"


def get_metal_recommended_working_set_bytes() -> int | None:
    """Read Metal's recommendation without MLX, PyObjC, or developer tools."""
    if platform.system() != "Darwin":
        return None
    try:
        metal = ctypes.CDLL(METAL_FRAMEWORK_PATH)
        objc = ctypes.CDLL(OBJC_LIBRARY_PATH)
        metal.MTLCreateSystemDefaultDevice.argtypes = []
        metal.MTLCreateSystemDefaultDevice.restype = ctypes.c_void_p
        objc.sel_registerName.argtypes = [ctypes.c_char_p]
        objc.sel_registerName.restype = ctypes.c_void_p
        send_uint = ctypes.CFUNCTYPE(ctypes.c_uint64, ctypes.c_void_p, ctypes.c_void_p)(
            ("objc_msgSend", objc),
        )
        send_void = ctypes.CFUNCTYPE(None, ctypes.c_void_p, ctypes.c_void_p)(
            ("objc_msgSend", objc),
        )
        device = metal.MTLCreateSystemDefaultDevice()
        if not device:
            return None
        try:
            value = int(send_uint(device, objc.sel_registerName(b"recommendedMaxWorkingSetSize")))
            return value if value > 0 else None
        finally:
            send_void(device, objc.sel_registerName(b"release"))
    except (OSError, AttributeError, TypeError, ValueError):
        return None


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
        dedicated_gpus = [*_nvidia_gpus(), *_rocm_gpus()]
        display_adapters = _windows_display_adapters() or _linux_display_adapters()
        if dedicated_gpus:
            has_cuda = any(gpu["backend"] == "CUDA" for gpu in dedicated_gpus)
            has_rocm = any(gpu["backend"] == "ROCm" for gpu in dedicated_gpus)
            display_adapters = [gpu for gpu in display_adapters if not (
                (has_cuda and "nvidia" in gpu["name"].lower())
                or (has_rocm and any(label in gpu["name"].lower() for label in ("amd", "ati", "radeon")))
            )]
        gpus = [*dedicated_gpus, *display_adapters]
        memory_mode = "dedicated" if dedicated_gpus else "system"
    gpus = [{**gpu, "index": index} for index, gpu in enumerate(gpus)]
    return {
        "platform": platform.system().lower(),
        "apple_silicon": is_apple_silicon,
        "metal_recommended_working_set_bytes": get_metal_recommended_working_set_bytes(),
        "memory_mode": memory_mode,
        "system_memory": {"total_bytes": memory.total, "available_bytes": memory.available},
        "gpus": gpus,
    }


def get_runtime_compatible_gpus(hardware: dict) -> list[dict]:
    """Return the dedicated GPU group one llama.cpp backend can use together."""
    dedicated = [gpu for gpu in hardware.get("gpus", []) if gpu.get("total_bytes") and not gpu.get("shared_memory")]
    if not dedicated:
        return []
    primary_backend = dedicated[0].get("backend")
    return [gpu for gpu in dedicated if gpu.get("backend") == primary_backend]


def recommend_gpu_split_percentages(hardware: dict) -> list[float]:
    """Recommend a tensor split percentage from compatible GPU capacities."""
    compatible = get_runtime_compatible_gpus(hardware)
    if len(compatible) < 2:
        return []
    capacities = [int(gpu["total_bytes"]) for gpu in compatible]
    total_capacity = sum(capacities)
    if total_capacity <= 0:
        return []
    percentages = [
        round(GPU_SPLIT_TOTAL_PERCENT * capacity / total_capacity, GPU_SPLIT_DECIMAL_PLACES)
        for capacity in capacities
    ]
    percentages[-1] = round(
        GPU_SPLIT_TOTAL_PERCENT - sum(percentages[:-1]), GPU_SPLIT_DECIMAL_PLACES,
    )
    return percentages


def validate_gpu_split_percentages(percentages: list[float], hardware: dict) -> list[float]:
    """Return a valid complete percentage split, or an empty list."""
    compatible = get_runtime_compatible_gpus(hardware)
    if len(compatible) < 2 or len(percentages) != len(compatible):
        return []
    values = [float(value) for value in percentages]
    if any(not math.isfinite(value) or value < 0 or value > GPU_SPLIT_TOTAL_PERCENT for value in values):
        return []
    if not math.isclose(sum(values), GPU_SPLIT_TOTAL_PERCENT, abs_tol=GPU_SPLIT_SUM_TOLERANCE):
        return []
    values = [round(value, GPU_SPLIT_DECIMAL_PLACES) for value in values]
    values[-1] = round(
        GPU_SPLIT_TOTAL_PERCENT - sum(values[:-1]), GPU_SPLIT_DECIMAL_PLACES,
    )
    return values


@lru_cache(maxsize=1)
def _settings_hardware_snapshot() -> dict:
    return get_local_hardware_info()


def get_settings_hardware_info() -> dict:
    """Session snapshot for settings UI; runtime admission still uses live data."""
    return copy.deepcopy(_settings_hardware_snapshot())
