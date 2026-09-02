import unittest
from unittest.mock import patch

from services.installer import get_linux_espeak_install_command


class LinuxInstallerTests(unittest.TestCase):
    def test_uses_first_available_supported_package_manager(self):
        available = {"sudo": "/usr/bin/sudo", "dnf": "/usr/bin/dnf"}
        with patch("services.installer.shutil.which", side_effect=available.get):
            self.assertEqual(
                get_linux_espeak_install_command(),
                ["sudo", "dnf", "-q", "-y", "install", "espeak-ng"],
            )

    def test_does_not_attempt_privileged_install_without_sudo(self):
        with patch("services.installer.shutil.which", return_value=None):
            self.assertIsNone(get_linux_espeak_install_command())


if __name__ == "__main__":
    unittest.main()
