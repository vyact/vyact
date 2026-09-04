"""Normalize uploaded audio for model input."""
import io
import wave

import av

AUDIO_SAMPLE_RATE = 16000


def m4a_to_wav(contents: bytes) -> bytes:
    output = io.BytesIO()
    with av.open(io.BytesIO(contents)) as source, wave.open(output, "wb") as target:
        if not source.streams.audio:
            raise ValueError("No audio stream")
        target.setnchannels(1)
        target.setsampwidth(2)
        target.setframerate(AUDIO_SAMPLE_RATE)
        resampler = av.AudioResampler(format="s16", layout="mono", rate=AUDIO_SAMPLE_RATE)
        samples = 0
        for frame in source.decode(audio=0):
            for converted in resampler.resample(frame):
                target.writeframesraw(bytes(converted.planes[0])[:converted.samples * 2])
                samples += converted.samples
        for converted in resampler.resample(None):
            target.writeframesraw(bytes(converted.planes[0])[:converted.samples * 2])
            samples += converted.samples
        if not samples:
            raise ValueError("Empty audio stream")
    return output.getvalue()
