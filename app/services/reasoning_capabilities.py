"""Detect per-model reasoning controls from local chat-template metadata."""
import json
import struct
from pathlib import Path


REASONING_EFFORTS = ("low", "medium", "high", "xhigh")
DEFAULT_REASONING_EFFORTS = ("low", "medium", "high")
_EFFORT_MARKERS = ("reasoning_effort", "reasoning_strength")
_TOGGLE_MARKERS = ("enable_thinking", "thinking_mode")
_GGUF_CHAT_TEMPLATE_KEYS = {
    "tokenizer.chat_template",
    "tokenizer.chat_templates",
}
_GGUF_SCALAR_FORMATS = {
    0: "B", 1: "b", 2: "H", 3: "h", 4: "I", 5: "i", 6: "f",
    7: "?", 10: "Q", 11: "q", 12: "d",
}


def _template_capabilities(template: str) -> dict:
    normalized = template.lower()
    has_effort = any(marker in normalized for marker in _EFFORT_MARKERS)
    has_toggle = any(marker in normalized for marker in _TOGGLE_MARKERS)
    if has_effort:
        mentioned_efforts = [
            effort for effort in REASONING_EFFORTS
            if f"'{effort}'" in normalized or f'"{effort}"' in normalized
        ]
        # A lone literal is normally the template default (commonly "medium"),
        # not its complete set of accepted values. Use the conservative common
        # effort set unless the template explicitly enumerates multiple levels.
        declared_efforts = mentioned_efforts if len(mentioned_efforts) > 1 else list(DEFAULT_REASONING_EFFORTS)
        return {
            "control": "effort",
            "efforts": declared_efforts,
            # Effort-based models always start at their least expensive level.
            # `none` belongs to toggle-based reasoning and is not an effort.
            "supports_none": False,
        }
    if has_toggle:
        return {"control": "toggle", "efforts": [], "supports_none": False}
    return {"control": "none", "efforts": [], "supports_none": False}


def _read_gguf_string(handle) -> str:
    length_data = handle.read(8)
    if len(length_data) != 8:
        raise ValueError("Incomplete GGUF string length")
    length = struct.unpack("<Q", length_data)[0]
    if length > 16 * 1024 * 1024:
        raise ValueError("GGUF metadata string is too large")
    value = handle.read(length)
    if len(value) != length:
        raise ValueError("Incomplete GGUF string")
    return value.decode("utf-8", errors="replace")


def _read_gguf_value(handle, value_type: int, *, keep: bool = False):
    if value_type in _GGUF_SCALAR_FORMATS:
        fmt = _GGUF_SCALAR_FORMATS[value_type]
        size = struct.calcsize(fmt)
        data = handle.read(size)
        if len(data) != size:
            raise ValueError("Incomplete GGUF scalar")
        return struct.unpack(f"<{fmt}", data)[0] if keep else None
    if value_type == 8:
        value = _read_gguf_string(handle)
        return value if keep else None
    if value_type == 9:
        element_type_data = handle.read(4)
        count_data = handle.read(8)
        if len(element_type_data) != 4 or len(count_data) != 8:
            raise ValueError("Incomplete GGUF array")
        element_type = struct.unpack("<I", element_type_data)[0]
        count = struct.unpack("<Q", count_data)[0]
        values = [] if keep else None
        for _ in range(count):
            value = _read_gguf_value(handle, element_type, keep=keep)
            if keep:
                values.append(value)
        return values
    raise ValueError("Unsupported GGUF metadata type")


def get_gguf_reasoning_capabilities(model_path: Path) -> dict:
    """Read only GGUF metadata and inspect its embedded chat template."""
    try:
        with model_path.open("rb") as handle:
            if handle.read(4) != b"GGUF":
                raise ValueError("Invalid GGUF header")
            version_data = handle.read(4)
            counts_data = handle.read(16)
            if len(version_data) != 4 or len(counts_data) != 16:
                raise ValueError("Incomplete GGUF header")
            version = struct.unpack("<I", version_data)[0]
            if version not in {2, 3}:
                raise ValueError("Unsupported GGUF version")
            _, metadata_count = struct.unpack("<QQ", counts_data)
            templates = []
            for _ in range(metadata_count):
                key = _read_gguf_string(handle)
                value_type_data = handle.read(4)
                if len(value_type_data) != 4:
                    raise ValueError("Incomplete GGUF metadata type")
                value_type = struct.unpack("<I", value_type_data)[0]
                keep = key in _GGUF_CHAT_TEMPLATE_KEYS
                value = _read_gguf_value(handle, value_type, keep=keep)
                if keep:
                    if isinstance(value, str):
                        templates.append(value)
                    elif isinstance(value, list):
                        templates.extend(str(item) for item in value)
            # Do not infer `none` from llama.cpp alone. Some templates accept an
            # arbitrary effort string but their model only understands concrete
            # levels, causing `none` to spend the whole output budget reasoning.
            return _template_capabilities("\n".join(templates))
    except (OSError, ValueError, struct.error):
        return {"control": "none", "efforts": [], "supports_none": False}


def get_mlx_reasoning_capabilities(model_path: Path) -> dict:
    """Inspect the tokenizer chat template shipped with an MLX repository."""
    try:
        config = json.loads((model_path / "tokenizer_config.json").read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        config = {}
    template = config.get("chat_template", "")
    if isinstance(template, dict):
        template = "\n".join(str(value) for value in template.values())
    elif isinstance(template, list):
        template = "\n".join(
            str(item.get("template", "")) if isinstance(item, dict) else str(item)
            for item in template
        )
    if not template:
        try:
            template = (model_path / "chat_template.jinja").read_text(encoding="utf-8")
        except OSError:
            template = ""
    return _template_capabilities(str(template))
