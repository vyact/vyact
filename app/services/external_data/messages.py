"""Localized user-facing messages for external-data retrieval failures."""

ALL_SEARCHES_FAILED_MESSAGES = {
    "ko": "선택한 외부 데이터를 현재 조회할 수 없습니다. 잠시 후 다시 시도해 주세요.",
    "en": "The selected external data is currently unavailable. Please try again shortly.",
    "ja": "選択した外部データを現在取得できません。しばらくしてからもう一度お試しください。",
    "zh": "目前无法查询所选的外部数据。请稍后重试。",
    "th": "ขณะนี้ไม่สามารถเรียกดูข้อมูลภายนอกที่เลือกได้ โปรดลองอีกครั้งในภายหลัง",
    "vi": "Hiện không thể truy xuất dữ liệu bên ngoài đã chọn. Vui lòng thử lại sau.",
    "es": "Los datos externos seleccionados no están disponibles en este momento. Inténtalo de nuevo en breve.",
    "fr": "Les données externes sélectionnées sont actuellement indisponibles. Veuillez réessayer dans quelques instants.",
}


def get_all_searches_failed_message(language: str | None) -> str:
    language_code = (language or "ko").split("-", 1)[0].lower()
    return ALL_SEARCHES_FAILED_MESSAGES.get(language_code, ALL_SEARCHES_FAILED_MESSAGES["en"])
