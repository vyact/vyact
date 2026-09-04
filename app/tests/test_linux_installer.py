import asyncio
import tempfile
import unittest
from pathlib import Path
from unittest.mock import AsyncMock, patch

from services.installer import Installer, get_linux_espeak_install_command
from services.linux_dependencies import _probe_chromium_dependencies, chromium_dependencies_available, linux_package_install_command


class LinuxInstallerTests(unittest.TestCase):
    def test_uses_first_available_supported_package_manager(self):
        available = {"sudo": "/usr/bin/sudo", "dnf": "/usr/bin/dnf"}
        with patch("services.linux_dependencies.shutil.which", side_effect=available.get), \
             patch("services.linux_dependencies.os.geteuid", return_value=1000):
            self.assertEqual(
                get_linux_espeak_install_command(),
                ["/usr/bin/sudo", "-n", "/usr/bin/dnf", "-q", "-y", "install", "espeak-ng"],
            )

    def test_does_not_attempt_privileged_install_without_sudo(self):
        with patch("services.linux_dependencies.shutil.which", return_value=None):
            self.assertIsNone(get_linux_espeak_install_command())

    def test_uses_graphical_authorization_before_sudo(self):
        available = {"pkexec": "/usr/bin/pkexec", "sudo": "/usr/bin/sudo", "dnf": "/usr/bin/dnf"}
        with patch("services.linux_dependencies.shutil.which", side_effect=available.get), \
             patch("services.linux_dependencies.os.geteuid", return_value=1000):
            self.assertEqual(linux_package_install_command("espeak")[:2], ["/usr/bin/pkexec", "/usr/bin/dnf"])

    def test_missing_shared_library_requires_dependencies(self):
        with patch("services.linux_dependencies.ctypes.CDLL", side_effect=OSError("missing libgbm")):
            self.assertFalse(_probe_chromium_dependencies())

    def test_oss_compatibility_library_does_not_count_as_alsa(self):
        with patch("services.linux_dependencies.ctypes.CDLL", return_value=object()):
            self.assertFalse(_probe_chromium_dependencies())

    def test_library_installation_is_rechecked_in_a_fresh_process(self):
        with patch("services.linux_dependencies.subprocess.run") as run:
            run.return_value.returncode = 1
            self.assertFalse(chromium_dependencies_available())
            run.return_value.returncode = 0
            self.assertTrue(chromium_dependencies_available())
            self.assertEqual(run.call_count, 2)

    def test_ubuntu_t64_alsa_package_is_selected(self):
        available = {"apt-get": "/usr/bin/apt-get", "apt-cache": "/usr/bin/apt-cache", "pkexec": "/usr/bin/pkexec"}
        with patch("services.linux_dependencies.shutil.which", side_effect=available.get), \
             patch("services.linux_dependencies.os.geteuid", return_value=1000), \
             patch("services.linux_dependencies.subprocess.run") as run:
            run.return_value.returncode = 0
            run.return_value.stdout = b"Package: libasound2t64\n"
            command = linux_package_install_command("chromium")
            self.assertIn("libasound2t64", command)
            self.assertNotIn("libasound2", command)

    def test_browser_install_keeps_python_unprivileged(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "bin").mkdir()
            (base / "bin" / "python").touch()
            installer = Installer(base, base, base, base / "install.log")
            with patch("services.installer.platform.system", return_value="Linux"), \
                 patch("services.installer.chromium_dependencies_available", side_effect=[False, True]), \
                 patch("services.installer.linux_package_install_command", return_value=["pkexec", "/usr/bin/apt-get", "install", "libgbm1"]), \
                 patch.object(installer, "_run", new_callable=AsyncMock, return_value=0) as run:
                self.assertTrue(asyncio.run(installer.install_playwright())[0])
                commands = [call.args[0] for call in run.call_args_list]
                self.assertEqual(commands[0][0], "pkexec")
                self.assertEqual(commands[1], [str(base / "bin" / "python"), "-m", "playwright", "install", "chromium"])

    def test_denied_authorization_stops_before_browser_install(self):
        with tempfile.TemporaryDirectory() as root:
            base = Path(root)
            (base / "bin").mkdir()
            (base / "bin" / "python").touch()
            installer = Installer(base, base, base, base / "install.log")
            with patch("services.installer.platform.system", return_value="Linux"), \
                 patch("services.installer.chromium_dependencies_available", return_value=False), \
                 patch("services.installer.linux_package_install_command", return_value=["pkexec", "/usr/bin/apt-get", "install", "libgbm1"]), \
                 patch.object(installer, "_run", new_callable=AsyncMock, return_value=126) as run:
                self.assertFalse(asyncio.run(installer.install_playwright())[0])
                run.assert_awaited_once()


if __name__ == "__main__":
    unittest.main()
