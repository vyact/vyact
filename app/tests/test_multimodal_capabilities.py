import json
import struct

from services.multimodal_capabilities import get_projector_modalities, get_mlx_modalities


def _gguf_string(value: str) -> bytes:
    encoded = value.encode("utf-8")
    return struct.pack("<Q", len(encoded)) + encoded


def _boolean_metadata(key: str, value: bool) -> bytes:
    return _gguf_string(key) + struct.pack("<I?", 7, value)


def test_projector_modalities_come_from_gguf_metadata(tmp_path):
    metadata = (
        _boolean_metadata("clip.has_vision_encoder", True)
        + _boolean_metadata("clip.has_audio_encoder", True)
    )
    projector = tmp_path / "projector.gguf"
    projector.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 2) + metadata)

    assert get_projector_modalities(projector) == ["image", "audio"]


def test_projector_filename_does_not_create_capabilities(tmp_path):
    projector = tmp_path / "dots3-note-mmproj.gguf"
    projector.write_bytes(b"GGUF" + struct.pack("<IQQ", 3, 0, 0))

    assert get_projector_modalities(projector) == []


def test_mlx_audio_requires_weights(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"vision_config": {}, "audio_config": {}}))
    assert get_mlx_modalities(tmp_path) == ["image"]
    header = json.dumps({"audio_tower.encoder.weight": {}}).encode()
    (tmp_path / "model-00002.safetensors").write_bytes(struct.pack("<Q", len(header)) + header)
    assert get_mlx_modalities(tmp_path) == ["image", "audio"]


def test_mlx_missing_and_invalid_config(tmp_path):
    assert get_mlx_modalities(tmp_path) == []
    (tmp_path / "config.json").write_text("[]")
    assert get_mlx_modalities(tmp_path) == []


def test_mlx_text_only(tmp_path):
    (tmp_path / "config.json").write_text(json.dumps({"text_config": {}, "audio_config": None}))
    assert get_mlx_modalities(tmp_path) == []
