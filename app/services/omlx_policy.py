"""Shared oMLX runtime and per-request policy constants."""

import json
import logging
import shutil
import subprocess
from collections.abc import Mapping
from pathlib import Path

SPECPREFILL_KEEP_PCT = 0.2
SPECPREFILL_THRESHOLD_TOKENS = 1024
# oMLX admits SpecPrefill only when token_count > threshold.
OMLX_SPECPREFILL_THRESHOLD = SPECPREFILL_THRESHOLD_TOKENS - 1
MAX_SPECPREFILL_DRAFT_BYTES = 2 * 1024 ** 3
MAX_SPECPREFILL_TARGET_SIZE_RATIO = 0.35
VLM_MTP_DRAFT_BLOCK_SIZE = 3
PAGED_SSD_CACHE_MAX_SIZE = "10GB"
HOT_CACHE_MAX_SIZE = "4GB"

logger = logging.getLogger(__name__)

# Safe fallback for installations which cannot expose their mlx-vlm registry.
_DEFAULT_EXTERNAL_MTP_TARGET_DRAFT_TYPES = (
    (("qwen3_5", "qwen3_6"), "qwen3_5_mtp"),
    (("gemma4",), "gemma4_assistant"),
)
_external_mtp_target_draft_types = _DEFAULT_EXTERNAL_MTP_TARGET_DRAFT_TYPES
_omlx_capability_signature: tuple[str, int] | None = None


def _target_prefixes_for_draft_type(draft_type: str) -> tuple[str, ...]:
    defaults = dict(
        (draft, prefixes) for prefixes, draft in _DEFAULT_EXTERNAL_MTP_TARGET_DRAFT_TYPES
    )
    if draft_type in defaults:
        return defaults[draft_type]
    for suffix in ("_assistant", "_mtp"):
        if draft_type.endswith(suffix) and len(draft_type) > len(suffix):
            return (draft_type[:-len(suffix)],)
    return ()


def _omlx_python_executable(executable: Path) -> str | None:
    try:
        first_line = executable.read_text(encoding="utf-8").splitlines()[0]
    except (OSError, UnicodeError, IndexError):
        return None
    return first_line[2:].strip() if first_line.startswith("#!") else None


def refresh_external_mtp_capabilities(force: bool = False) -> tuple[tuple[tuple[str, ...], str], ...]:
    """Read External MTP drafter types from the installed oMLX environment."""
    global _external_mtp_target_draft_types, _omlx_capability_signature
    executable_name = shutil.which("omlx")
    if not executable_name:
        _external_mtp_target_draft_types = _DEFAULT_EXTERNAL_MTP_TARGET_DRAFT_TYPES
        _omlx_capability_signature = None
        return _external_mtp_target_draft_types
    try:
        executable = Path(executable_name).resolve()
        signature = (str(executable), executable.stat().st_mtime_ns)
    except OSError:
        return _external_mtp_target_draft_types
    if not force and signature == _omlx_capability_signature:
        return _external_mtp_target_draft_types

    python_executable = _omlx_python_executable(executable)
    if not python_executable:
        return _external_mtp_target_draft_types
    probe = (
        "import json; "
        "from mlx_vlm.speculative.drafters import DRAFTER_KIND_BY_MODEL_TYPE; "
        "print(json.dumps(sorted(k for k,v in DRAFTER_KIND_BY_MODEL_TYPE.items() if v=='mtp')))"
    )
    try:
        result = subprocess.run(
            [python_executable, "-c", probe], capture_output=True, text=True, timeout=10, check=True,
        )
        draft_types = json.loads(result.stdout.strip())
        discovered = tuple(
            (prefixes, draft_type)
            for draft_type in draft_types if isinstance(draft_type, str)
            if (prefixes := _target_prefixes_for_draft_type(draft_type))
        )
        if discovered:
            _external_mtp_target_draft_types = discovered
            logger.info("[omlx] External MTP capabilities: %s", ", ".join(draft_types))
        _omlx_capability_signature = signature
    except (OSError, subprocess.SubprocessError, ValueError, TypeError) as error:
        logger.warning("[omlx] External MTP capability detection failed: %s", error)
    return _external_mtp_target_draft_types


def external_mtp_draft_types() -> frozenset[str]:
    return frozenset(draft_type for _, draft_type in refresh_external_mtp_capabilities())


def model_type(config: Mapping | None) -> str:
    """Return a normalized Hugging Face model type."""
    return str((config or {}).get("model_type") or "").lower()


def external_mtp_draft_type(config: Mapping | None) -> str | None:
    """Return the oMLX External MTP draft type supported by a target config."""
    target_type = model_type(config)
    matches = [
        (len(target_prefix), draft_type)
        for target_prefixes, draft_type in refresh_external_mtp_capabilities()
        for target_prefix in target_prefixes
        if target_type.startswith(target_prefix)
    ]
    return max(matches, key=lambda match: match[0])[1] if matches else None


def is_external_mtp_compatible(
        target_config: Mapping | None, draft_config: Mapping | None,
) -> bool:
    """Validate both oMLX architecture support and shared model dimensions."""
    expected_draft_type = external_mtp_draft_type(target_config)
    if expected_draft_type is None or model_type(draft_config) != expected_draft_type:
        return False

    def language_config(config: Mapping) -> Mapping:
        text_config = config.get("text_config")
        return text_config if isinstance(text_config, Mapping) else config

    target_language = language_config(target_config or {})
    draft_language = language_config(draft_config or {})
    matched_dimensions = 0
    for key in ("hidden_size", "vocab_size", "num_attention_heads", "num_key_value_heads"):
        target_value = target_language.get(key)
        draft_value = draft_language.get(key)
        if key == "hidden_size":
            draft_value = (
                draft_config.get("backbone_hidden_size")
                or draft_config.get("target_hidden_size")
                or draft_value
            )
        if target_value is None or draft_value is None:
            continue
        if target_value != draft_value:
            return False
        matched_dimensions += 1
    return matched_dimensions > 0
