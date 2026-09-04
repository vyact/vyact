"""Detect llama.cpp multimodal support from projector GGUF metadata."""
import json
import struct
from pathlib import Path

from services.reasoning_capabilities import read_gguf_metadata


_PROJECTOR_MODALITY_KEYS = {
    "clip.has_vision_encoder",
    "clip.has_audio_encoder",
}


def get_projector_modalities(projector_path: Path | None) -> list[str]:
    """Return projector-declared modalities without model-name inference."""
    if projector_path is None:
        return []
    metadata = read_gguf_metadata(projector_path, _PROJECTOR_MODALITY_KEYS)
    modalities = []
    if metadata.get("clip.has_vision_encoder") is True:
        modalities.append("image")
    if metadata.get("clip.has_audio_encoder") is True:
        modalities.append("audio")
    return modalities


_MAX_SAFETENSORS_HEADER_BYTES = 100 * 1024 * 1024
_MLX_AUDIO_WEIGHT_PREFIXES = ("audio_tower.", "embed_audio.")


def get_mlx_modalities(model_path: Path) -> list[str]:
    """Inspect installed oMLX input capabilities without loading tensor data."""
    try:
        config = json.loads((model_path / "config.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return []
    if not isinstance(config, dict):
        return []
    modalities = ["image"] if isinstance(config.get("vision_config"), dict) else []
    if not isinstance(config.get("audio_config"), dict):
        return modalities
    weight_paths = list(model_path.glob("*.safetensors"))
    sidecar_config = config.get("optiq_vision")
    if isinstance(sidecar_config, dict) and isinstance(sidecar_config.get("sidecar"), str):
        sidecar = (model_path / sidecar_config["sidecar"]).resolve()
        if sidecar.is_relative_to(model_path.resolve()) and sidecar.suffix == ".safetensors":
            weight_paths.append(sidecar)
    for weight_path in weight_paths:
        try:
            with weight_path.open("rb") as weight_file:
                header_size = struct.unpack("<Q", weight_file.read(8))[0]
                if header_size > _MAX_SAFETENSORS_HEADER_BYTES:
                    continue
                header = json.loads(weight_file.read(header_size))
            if isinstance(header, dict) and any(key.startswith(_MLX_AUDIO_WEIGHT_PREFIXES) for key in header):
                modalities.append("audio")
                break
        except (OSError, ValueError, struct.error):
            continue
    return modalities
