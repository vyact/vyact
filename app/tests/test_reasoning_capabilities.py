import json
import struct
import tempfile
import unittest
from pathlib import Path

from services.reasoning_capabilities import (
    get_gguf_reasoning_capabilities,
    get_mlx_reasoning_capabilities,
)


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


class ReasoningCapabilitiesTests(unittest.TestCase):
    def test_mlx_effort_template_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "tokenizer_config.json").write_text(json.dumps({
                "chat_template": "{% if reasoning_effort == 'low' %}{% endif %}",
            }), encoding="utf-8")

            capabilities = get_mlx_reasoning_capabilities(model_path)

        self.assertEqual(capabilities["control"], "effort")
        self.assertEqual(capabilities["efforts"], ["low", "medium", "high"])
        self.assertFalse(capabilities["supports_none"])

    def test_mlx_toggle_template_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "tokenizer_config.json").write_text(json.dumps({
                "chat_template": "{% if enable_thinking %}<think>{% endif %}",
            }), encoding="utf-8")

            capabilities = get_mlx_reasoning_capabilities(model_path)

        self.assertEqual(capabilities["control"], "toggle")

    def test_mlx_standalone_jinja_template_is_detected(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "tokenizer_config.json").write_text("{}", encoding="utf-8")
            (model_path / "chat_template.jinja").write_text(
                "{% if enable_thinking %}<think>{% endif %}", encoding="utf-8",
            )

            capabilities = get_mlx_reasoning_capabilities(model_path)

        self.assertEqual(capabilities["control"], "toggle")

    def test_gguf_embedded_template_is_detected_without_loading_tensors(self):
        template = "{% if reasoning_effort == 'medium' %}<think>{% endif %}"
        metadata = (
            _gguf_string("tokenizer.chat_template")
            + struct.pack("<I", 8)
            + _gguf_string(template)
        )
        payload = b"GGUF" + struct.pack("<IQQ", 3, 0, 1) + metadata
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory) / "model.gguf"
            model_path.write_bytes(payload)

            capabilities = get_gguf_reasoning_capabilities(model_path)

        self.assertEqual(capabilities["control"], "effort")
        self.assertEqual(capabilities["efforts"], ["low", "medium", "high"])

    def test_explicit_effort_list_preserves_extra_high(self):
        with tempfile.TemporaryDirectory() as directory:
            model_path = Path(directory)
            (model_path / "tokenizer_config.json").write_text(json.dumps({
                "chat_template": "{% if reasoning_effort in ['low', 'medium', 'high', 'xhigh'] %}{% endif %}",
            }), encoding="utf-8")

            capabilities = get_mlx_reasoning_capabilities(model_path)

        self.assertEqual(capabilities["efforts"], ["low", "medium", "high", "xhigh"])


if __name__ == "__main__":
    unittest.main()
