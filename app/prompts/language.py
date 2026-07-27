"""사용자 UI 언어를 LLM 프롬프트용 표시 이름으로 변환한다."""

LANGUAGE_LABELS = {
    "ko": "한국어",
    "en": "English",
    "ja": "日本語",
    "zh": "中文",
    "th": "ภาษาไทย",
    "vi": "Tiếng Việt",
    "es": "Español",
    "fr": "Français",
}


def normalize_language_code(language: str) -> str:
    """i18n 언어 태그를 지원 언어 코드로 정규화한다."""
    language_code = (language or "").lower().replace("_", "-").split("-", 1)[0]
    return language_code if language_code in LANGUAGE_LABELS else "en"


def get_language_label(language: str) -> str:
    """지원하지 않는 언어는 시스템 기본 언어인 영어로 반환한다."""
    return LANGUAGE_LABELS[normalize_language_code(language)]
