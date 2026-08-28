import unittest

import httpx

from services.llm.errors import is_insufficient_memory_error


class LlmErrorTests(unittest.TestCase):
    @staticmethod
    def _status_error(status_code: int, payload: dict) -> httpx.HTTPStatusError:
        request = httpx.Request("POST", "http://localhost/v1/chat/completions")
        response = httpx.Response(status_code, request=request, json=payload)
        return httpx.HTTPStatusError("provider error", request=request, response=response)

    def test_detects_omlx_dynamic_memory_ceiling_error(self):
        error = self._status_error(507, {
            "error": {"message": "Model does not fit under the dynamic memory ceiling (6.43GB)."},
        })
        self.assertTrue(is_insufficient_memory_error(error))

    def test_detects_cuda_out_of_memory_error(self):
        error = self._status_error(500, {"error": {"message": "CUDA out of memory"}})
        self.assertTrue(is_insufficient_memory_error(error))

    def test_does_not_treat_disk_capacity_error_as_memory_error(self):
        error = self._status_error(507, {"error": {"message": "Insufficient disk storage"}})
        self.assertFalse(is_insufficient_memory_error(error))
