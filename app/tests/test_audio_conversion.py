import io
import wave

import av
import numpy as np
import pytest

from services.audio_conversion import m4a_to_wav


def test_m4a_aac_is_converted_to_pcm_wav():
    encoded = io.BytesIO()
    with av.open(encoded, 'w', format='mp4') as container:
        stream = container.add_stream('aac', rate=48000)
        stream.layout = 'mono'
        samples = np.sin(np.arange(4800) * 2 * np.pi * 440 / 48000).astype(np.float32)
        frame = av.AudioFrame.from_ndarray(samples.reshape(1, -1), format='fltp', layout='mono')
        frame.sample_rate = 48000
        for packet in stream.encode(frame):
            container.mux(packet)
        for packet in stream.encode(None):
            container.mux(packet)
    with wave.open(io.BytesIO(m4a_to_wav(encoded.getvalue()))) as result:
        assert result.getframerate() == 16000
        assert result.getnchannels() == 1
        assert result.getsampwidth() == 2
        assert result.getnframes() >= 1600


def test_invalid_m4a_is_rejected():
    with pytest.raises(av.error.InvalidDataError):
        m4a_to_wav(b'not an audio file')
