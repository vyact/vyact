"""
prompts/user.py – 유저 프롬프트 조합 로직

이미지 첨부 안내(image_notice)와 context_docs 포맷,
최종 user_prompt 문자열 생성을 담당합니다.
"""
from .format_rules import get_file_format_style


def build_image_notice(image_count: int) -> str:
    """이미지 첨부 개수에 따른 안내 문구 반환"""
    if image_count == 1:
        return (
            "\n\n[첨부 이미지: 이미지 1장이 첨부되어 있습니다. "
            "이미지를 직접 확인하고 내용에 맞게 분석하세요.]"
        )
    if image_count > 1:
        return f"\n\n[첨부 이미지: 총 {image_count}장 첨부됨. 모두 확인하여 분석해주세요.]"
    return ""


CHUNK_TYPE_PREFIX = {
    "table":     "[표]",
    "code":      "[코드]",
    "heading":   "[제목]",
    "caption":   "[캡션]",
    "paragraph": "",
}

# 파일 확장자 → 코드펜스 언어 태그 (XML 스타일에서 코드 하이라이팅/경계 명확화용)
EXT_TO_FENCE_LANG = {
    ".py": "python", ".ts": "typescript", ".tsx": "tsx", ".js": "javascript", ".jsx": "jsx",
    ".java": "java", ".kt": "kotlin", ".go": "go", ".rs": "rust", ".c": "c", ".cpp": "cpp",
    ".h": "c", ".cs": "csharp", ".swift": "swift", ".yaml": "yaml", ".yml": "yaml",
    ".json": "json", ".sh": "bash", ".sql": "sql", ".xml": "xml", ".css": "css",
    ".vue": "vue", ".rb": "ruby", ".php": "php", ".md": "markdown",
}


def _fence_lang_for(title: str) -> str:
    for ext, lang in EXT_TO_FENCE_LANG.items():
        if title.lower().endswith(ext):
            return lang
    return ""


def _fmt_doc_markdown(i: int, d: dict) -> str:
    """단일 문서를 마크다운 스타일로 포맷 (기존 방식, gemma 등 기본 모델용)"""
    date = (d.get("indexed_at") or d.get("updated_at") or "")[:10]
    date_str = f" | {date}" if date else ""
    chunk_prefix = CHUNK_TYPE_PREFIX.get(d.get("chunk_type", ""), "")
    type_str = f" {chunk_prefix}" if chunk_prefix else ""

    # PDF 페이지 번호
    page = d.get("page_number")
    page_str = f" | p.{page}" if page else ""

    return f"\n[문서 {i}]{type_str} 출처: {d['source']}{date_str}{page_str} | {d['title']}\n{d['content']}\n"


def _fmt_doc_xml(i: int, d: dict) -> str:
    """단일 문서를 XML 태그 + 코드펜스로 포맷 (Claude 등 XML 친화 모델용)

    코드 내용을 태그 안에 그대로 넣지 않고 코드펜스로 한 겹 더 감싼다.
    TSX/JSX처럼 실제 `<`, `>`를 포함한 코드가 <document> 태그 구조와 섞여
    보이는 것을 방지하기 위함이다.
    """
    date = (d.get("indexed_at") or d.get("updated_at") or "")[:10]
    page = d.get("page_number")
    lang = _fence_lang_for(d.get("title", ""))

    attrs = [f'index="{i}"', f'source="{d["source"]}"', f'title="{d["title"]}"']
    if date:
        attrs.append(f'date="{date}"')
    if page:
        attrs.append(f'page="{page}"')
    attr_str = " ".join(attrs)

    return (
        f'\n<document {attr_str}>\n'
        f'```{lang}\n{d["content"]}\n```\n'
        f'</document>\n'
    )


def build_user_prompt(
        question: str,
        context_docs: list[dict],
        attachments: list,
        model: str = "",
) -> str:
    """
    최종 user_prompt 문자열을 조합하여 반환합니다.

    - context_docs가 있으면 참고 문서 섹션을 앞에 붙임
    - 이미지 첨부가 있으면 image_notice를 끝에 붙임
    - model에 따라 포맷 스타일(xml/markdown)이 달라짐 (prompts/format_rules.py 참고)
    """
    image_count = sum(1 for a in attachments if a.get("type") == "image") if attachments else 0
    image_notice = build_image_notice(image_count)

    if context_docs:
        style = get_file_format_style(model)
        fmt_doc = _fmt_doc_xml if style == "xml" else _fmt_doc_markdown
        ctx = "".join(fmt_doc(i, d) for i, d in enumerate(context_docs, 1))
        return f"**검색된 참고 문서:**\n{ctx}\n\n**사용자 질문:**\n{question}{image_notice}"

    return f"{question}{image_notice}"
