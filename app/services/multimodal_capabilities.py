"""Detect llama.cpp multimodal support from projector GGUF metadata."""
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
