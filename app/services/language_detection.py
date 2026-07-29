"""Offline language detection for multilingual RAG routing."""
from __future__ import annotations

import re
from functools import lru_cache

from lingua import Language, LanguageDetectorBuilder

SUPPORTED_LANGUAGES = {
    Language.KOREAN: "ko",
    Language.ENGLISH: "en",
    Language.JAPANESE: "ja",
    Language.CHINESE: "zh",
    Language.THAI: "th",
    Language.VIETNAMESE: "vi",
    Language.SPANISH: "es",
    Language.FRENCH: "fr",
}
UNKNOWN_LANGUAGE = "und"
MIN_DETECTABLE_LETTERS = 12

_KOREAN_RE = re.compile(r"[\uac00-\ud7a3]")
_JAPANESE_RE = re.compile(r"[\u3040-\u30ff]")
_THAI_RE = re.compile(r"[\u0e00-\u0e7f]")
_HAN_RE = re.compile(r"[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]")
_LETTER_RE = re.compile(r"[^\W\d_]", re.UNICODE)


@lru_cache(maxsize=1)
def _detector():
    return LanguageDetectorBuilder.from_languages(*SUPPORTED_LANGUAGES).build()


def detect_language(text: str | None) -> str:
    """Return a supported language code, or ``und`` when the text is uncertain."""
    value = (text or "").strip()
    if not value:
        return UNKNOWN_LANGUAGE
    if _KOREAN_RE.search(value):
        return "ko"
    if _JAPANESE_RE.search(value):
        return "ja"
    if _THAI_RE.search(value):
        return "th"
    if _HAN_RE.search(value):
        return "zh"
    if len(_LETTER_RE.findall(value)) < MIN_DETECTABLE_LETTERS:
        return UNKNOWN_LANGUAGE

    confidence_values = _detector().compute_language_confidence_values(value)
    if not confidence_values or confidence_values[0].value < 0.60:
        return UNKNOWN_LANGUAGE
    return SUPPORTED_LANGUAGES.get(confidence_values[0].language, UNKNOWN_LANGUAGE)
