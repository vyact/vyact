"""Shared presentation design normalization for PDF and PPTX renderers."""
from __future__ import annotations

import copy
import re


SUPPORTED_LAYOUTS = {
    "cover", "content", "two_column", "stats", "data_chart", "quote",
    "timeline", "process", "comparison", "spotlight", "card_grid",
    "image_focus", "closing",
}

SEQUENCE_MARKERS = re.compile(
    r"(?:^|\s)(?:20\d{2}|Q[1-4]|[1-9]\d?월|Phase|Step|First|Next|Finally)",
    re.IGNORECASE,
)
COMPARISON_MARKERS = re.compile(
    r"(?:vs\.?|대비|비교|장점|단점|현재|목표|before|after|pros?|cons?)",
    re.IGNORECASE,
)
ACTION_MARKERS = re.compile(
    r"(?:실행|도입|구축|확대|전환|개선|추진|action|implement|build|launch|scale)",
    re.IGNORECASE,
)
NUMBER_PATTERN = re.compile(r"[-+]?\d[\d,.]*(?:%|배|억|만|조|K|M|B|x|×)?", re.IGNORECASE)


def _text_blob(page: dict) -> str:
    values = [page.get("title"), page.get("subtitle"), page.get("content")]
    values.extend(page.get("bullets") or [])
    return " ".join(str(value) for value in values if value)


def _numeric_stat_count(page: dict) -> int:
    return sum(bool(NUMBER_PATTERN.search(str(stat.get("value", "")))) for stat in page.get("stats") or [])


def _choose_layout(page: dict, index: int, total: int) -> str:
    if index == 0:
        return "cover"
    if index == total - 1:
        return "closing"

    requested = page.get("layout", "content")
    if requested not in SUPPORTED_LAYOUTS:
        requested = "content"
    bullets = page.get("bullets") or []
    text = _text_blob(page)
    has_image = page.get("image_index") is not None

    if _numeric_stat_count(page) >= 3:
        return "data_chart" if index % 2 == 0 else "stats"
    # Some smaller/local models populate ``quote`` even when they selected a
    # timeline, comparison, or content layout.  Treat quote as authoritative
    # only when the model explicitly requested a quote page; otherwise a
    # stray quote collapses a varied deck into repeated quotation panels.
    if requested == "quote" and page.get("quote"):
        return "quote"
    if has_image:
        return "image_focus" if page.get("image_position") == "full" else "two_column"
    # Preserve the model's explicit semantic choice when the required data is
    # present. Inference below is a fallback for generic/invalid layout output,
    # not a reason to turn a requested comparison into a process diagram.
    if requested == "timeline" and len(bullets) >= 3:
        return "timeline"
    if requested == "comparison" and len(bullets) >= 4:
        return "comparison"
    if requested == "process" and len(bullets) >= 3:
        return "process"
    if len(bullets) >= 3 and SEQUENCE_MARKERS.search(text):
        return "timeline"
    if len(bullets) >= 4 and COMPARISON_MARKERS.search(text):
        return "comparison"
    if 3 <= len(bullets) <= 5 and ACTION_MARKERS.search(text):
        return "process"
    return requested


def prepare_presentation(page_data: dict) -> dict:
    """Return a normalized copy with varied, renderer-independent design metadata."""
    prepared = copy.deepcopy(page_data)
    pages = prepared.get("pages") or []
    language = prepared.get("language", "en")
    total = len(pages)
    previous_layout = None
    repeated_layouts = 0

    for index, page in enumerate(pages):
        page["index"] = index
        layout = _choose_layout(page, index, total)
        if layout == previous_layout and layout not in {"cover", "closing"}:
            repeated_layouts += 1
        else:
            repeated_layouts = 1

        if repeated_layouts > 1:
            bullets = page.get("bullets") or []
            if layout in {"content", "card_grid", "spotlight"}:
                layout = "card_grid" if previous_layout != "card_grid" and len(bullets) >= 4 else "spotlight"
            elif layout in {"stats", "data_chart"}:
                layout = "data_chart" if previous_layout != "data_chart" else "stats"
            repeated_layouts = 1

        page["layout"] = layout
        page["visual_variant"] = index % 3
        page["section_label"] = page.get("section_label") or _section_label(layout, language)
        page["bullets"] = [str(item).strip() for item in (page.get("bullets") or []) if str(item).strip()][:6]
        page["stats"] = (page.get("stats") or [])[:4]
        previous_layout = layout

    return prepared


def _section_label(layout: str, language: str) -> str:
    translations = {
        "ko": ["핵심 지표", "데이터 인사이트", "관점", "타임라인", "실행 계획", "비교", "핵심 메시지", "인사이트 맵", "상세 분석", "비주얼 스토리", "개요"],
        "en": ["KEY METRICS", "DATA INSIGHT", "PERSPECTIVE", "TIMELINE", "ACTION PLAN", "COMPARISON", "KEY TAKEAWAY", "INSIGHT MAP", "DEEP DIVE", "VISUAL STORY", "OVERVIEW"],
        "es": ["MÉTRICAS CLAVE", "ANÁLISIS DE DATOS", "PERSPECTIVA", "CRONOLOGÍA", "PLAN DE ACCIÓN", "COMPARACIÓN", "IDEA CLAVE", "MAPA DE IDEAS", "ANÁLISIS", "HISTORIA VISUAL", "RESUMEN"],
        "fr": ["INDICATEURS CLÉS", "ANALYSE DES DONNÉES", "PERSPECTIVE", "CHRONOLOGIE", "PLAN D’ACTION", "COMPARAISON", "MESSAGE CLÉ", "CARTE D’IDÉES", "ANALYSE", "RÉCIT VISUEL", "APERÇU"],
        "zh": ["核心指标", "数据洞察", "观点", "时间线", "行动计划", "对比", "核心结论", "洞察图谱", "深入分析", "视觉叙事", "概览"],
        "ja": ["主要指標", "データ分析", "視点", "タイムライン", "実行計画", "比較", "重要ポイント", "インサイトマップ", "詳細分析", "ビジュアルストーリー", "概要"],
        "th": ["ตัวชี้วัดหลัก", "ข้อมูลเชิงลึก", "มุมมอง", "ไทม์ไลน์", "แผนปฏิบัติการ", "การเปรียบเทียบ", "ประเด็นสำคัญ", "แผนผังข้อมูล", "การวิเคราะห์", "เรื่องราวภาพ", "ภาพรวม"],
        "vi": ["CHỈ SỐ CHÍNH", "PHÂN TÍCH DỮ LIỆU", "GÓC NHÌN", "LỘ TRÌNH", "KẾ HOẠCH", "SO SÁNH", "THÔNG ĐIỆP CHÍNH", "BẢN ĐỒ Ý TƯỞNG", "PHÂN TÍCH", "CÂU CHUYỆN HÌNH ẢNH", "TỔNG QUAN"],
    }
    layout_order = ["stats", "data_chart", "quote", "timeline", "process", "comparison", "spotlight", "card_grid", "two_column", "image_focus", "content"]
    labels = translations.get(language, translations["en"])
    return labels[layout_order.index(layout)] if layout in layout_order else ""
