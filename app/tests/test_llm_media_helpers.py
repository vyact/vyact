import base64

from services.llm import helpers


def test_audio_attachment_uses_input_audio_content_block(tmp_path, monkeypatch):
    monkeypatch.setattr(helpers, "AUDIO_DIR", tmp_path)
    audio = tmp_path / "sample.wav"
    audio.write_bytes(b"RIFF-audio")

    blocks = helpers.load_audio_content_blocks([{"type": "audio", "filename": "sample.wav"}])

    assert blocks == [{
        "type": "input_audio",
        "input_audio": {
            "data": base64.b64encode(b"RIFF-audio").decode("utf-8"),
            "format": "wav",
        },
    }]


def test_audio_attachment_cannot_escape_managed_directory(tmp_path, monkeypatch):
    monkeypatch.setattr(helpers, "AUDIO_DIR", tmp_path)
    outside = tmp_path.parent / "outside.wav"
    outside.write_bytes(b"outside")

    assert helpers.load_audio_content_blocks([{"type": "audio", "filename": "../outside.wav"}]) == []
