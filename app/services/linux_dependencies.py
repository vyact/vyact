"""Install native desktop dependencies through the system package manager."""
import ctypes
import os
import shutil
import subprocess
import sys
from pathlib import Path


CHROMIUM_LIBRARIES = (
    "libnss3.so", "libatk-1.0.so.0", "libatk-bridge-2.0.so.0",
    "libcups.so.2", "libdrm.so.2", "libdbus-1.so.3", "libX11.so.6",
    "libXcomposite.so.1", "libXdamage.so.1", "libXext.so.6",
    "libXfixes.so.3", "libXrandr.so.2", "libgbm.so.1",
    "libxcb.so.1", "libxkbcommon.so.0", "libasound.so.2",
    "libpango-1.0.so.0", "libcairo.so.2", "libatspi.so.0",
)
CHROMIUM_PACKAGES = {
    "apt-get": ["libnss3", "libgtk-3-0", "libgbm1", "libasound2", "fonts-liberation", "fonts-noto-color-emoji"],
    "dnf": ["nss", "atk", "at-spi2-atk", "cups-libs", "libdrm", "dbus-libs", "libX11", "libXcomposite", "libXdamage", "libXext", "libXfixes", "libXrandr", "mesa-libgbm", "libxcb", "libxkbcommon", "alsa-lib", "pango", "cairo", "at-spi2-core"],
    "zypper": ["mozilla-nss", "libatk-1_0-0", "libatk-bridge-2_0-0", "libcups2", "libdrm2", "libdbus-1-3", "libX11-6", "libXcomposite1", "libXdamage1", "libXext6", "libXfixes3", "libXrandr2", "libgbm1", "libxcb1", "libxkbcommon0", "libasound2", "libpango-1_0-0", "libcairo2", "libatspi0"],
    "pacman": ["nss", "at-spi2-core", "libcups", "libdrm", "dbus", "libx11", "libxcomposite", "libxdamage", "libxext", "libxfixes", "libxrandr", "mesa", "libxcb", "libxkbcommon", "alsa-lib", "pango", "cairo"],
}
PACKAGE_INSTALL_ARGS = {
    "apt-get": ["-qq", "-y", "install"],
    "dnf": ["-q", "-y", "install"],
    "zypper": ["--non-interactive", "install"],
    "pacman": ["--noconfirm", "-S", "--needed"],
}


def _probe_chromium_dependencies() -> bool:
    for library in CHROMIUM_LIBRARIES:
        try:
            loaded = ctypes.CDLL(library)
            # OSS can provide this SONAME without the ALSA API Chromium needs.
            if library == "libasound.so.2" and not hasattr(loaded, "snd_device_name_get_hint"):
                return False
        except OSError:
            return False
    return True


def chromium_dependencies_available() -> bool:
    # dlopen retains loaded libraries. Probe in a fresh process so a successful
    # package installation is not followed by a check against the old library.
    try:
        result = subprocess.run(
            [sys.executable, "-I", str(Path(__file__).resolve())],
            capture_output=True,
            timeout=15,
        )
        return result.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


def linux_package_install_command(feature: str) -> list[str] | None:
    """Use a graphical authorization agent; never wait for a terminal password."""
    for manager, arguments in PACKAGE_INSTALL_ARGS.items():
        executable = shutil.which(manager)
        if not executable:
            continue
        packages = ["espeak-ng"] if feature == "espeak" else CHROMIUM_PACKAGES[manager].copy()
        if manager == "apt-get" and "libasound2" in packages:
            # Ubuntu 24.04 renamed ALSA and leaves libasound2 as a virtual package.
            apt_cache = shutil.which("apt-cache")
            if apt_cache:
                result = subprocess.run([apt_cache, "show", "libasound2t64"], capture_output=True, timeout=15)
                if result.returncode == 0 and b"Package: libasound2t64" in result.stdout:
                    packages[packages.index("libasound2")] = "libasound2t64"
        command = [executable, *arguments, *packages]
        if os.geteuid() == 0:
            return command
        pkexec = shutil.which("pkexec")
        if pkexec:
            return [pkexec, *command]
        sudo = shutil.which("sudo")
        if sudo:
            return [sudo, "-n", *command]
        return None
    return None


if __name__ == "__main__":
    sys.exit(0 if _probe_chromium_dependencies() else 1)
