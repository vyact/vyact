import unittest
from unittest.mock import patch

from services.hardware_info import _nvidia_gpus, get_local_hardware_info, recommend_gpu_split_percentages, validate_gpu_split_percentages


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
        self.assertTrue(hardware["apple_silicon"])
        self.assertEqual(hardware["memory_mode"], "unified")
        self.assertTrue(hardware["gpus"][0]["shared_memory"])
        self.assertEqual(hardware["gpus"][0]["backend"], "Metal")
        self.assertEqual(hardware["gpus"][0]["index"], 0)

    def test_recommends_multi_gpu_split_from_vram_ratio(self):
        hardware = {"gpus": [
            {"backend": "CUDA", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
            {"backend": "CUDA", "total_bytes": 12 * 1024 ** 3, "shared_memory": False},
        ]}

        percentages = recommend_gpu_split_percentages(hardware)

        self.assertEqual(percentages, [66.7, 33.3])

    def test_does_not_mix_gpu_backends_in_one_runtime_split(self):
        hardware = {"gpus": [
            {"backend": "CUDA", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
            {"backend": "ROCm", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
        ]}

        self.assertEqual(recommend_gpu_split_percentages(hardware), [])

    def test_validates_complete_gpu_split_percentages(self):
        hardware = {"gpus": [
            {"backend": "CUDA", "total_bytes": 24 * 1024 ** 3, "shared_memory": False},
            {"backend": "CUDA", "total_bytes": 12 * 1024 ** 3, "shared_memory": False},
        ]}

        self.assertEqual(validate_gpu_split_percentages([66.7, 33.3], hardware), [66.7, 33.3])
        self.assertEqual(validate_gpu_split_percentages([70, 20], hardware), [])
        self.assertEqual(validate_gpu_split_percentages([100, 0], hardware), [100.0, 0.0])
