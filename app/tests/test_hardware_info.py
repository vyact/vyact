import unittest
from unittest.mock import patch

from services.hardware_info import _nvidia_gpus, get_local_hardware_info


class HardwareInfoTests(unittest.TestCase):
    @patch("services.hardware_info._run_command", return_value="NVIDIA RTX 4070, 12282, 10420")
    @patch("services.hardware_info.shutil.which", return_value="/usr/bin/nvidia-smi")
    def test_nvidia_memory_is_reported_in_bytes(self, _which, _run):
        self.assertEqual(_nvidia_gpus(), [{
            "name": "NVIDIA RTX 4070", "backend": "CUDA",
            "total_bytes": 12282 * 1024 ** 2,
            "available_bytes": 10420 * 1024 ** 2,
            "shared_memory": False,
        }])

    @patch("services.hardware_info._nvidia_gpus", return_value=[])
    @patch("services.hardware_info.platform.machine", return_value="arm64")
    @patch("services.hardware_info.platform.system", return_value="Darwin")
    def test_apple_silicon_uses_unified_memory(self, _system, _machine, _nvidia):
        hardware = get_local_hardware_info()
        self.assertEqual(hardware["memory_mode"], "unified")
        self.assertTrue(hardware["gpus"][0]["shared_memory"])
        self.assertEqual(hardware["gpus"][0]["backend"], "Metal")
