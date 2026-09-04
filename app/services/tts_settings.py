"""Shared supported playback rates for TTS settings endpoints."""
TTS_RATE_OPTIONS = (1.0, 1.2, 1.5, 1.8, 2.0)


def normalize_tts_rate(value) -> float:
    try:
        rate = float(value)
    except (TypeError, ValueError):
        return 1.0
    return min(TTS_RATE_OPTIONS, key=lambda candidate: abs(candidate - rate))
