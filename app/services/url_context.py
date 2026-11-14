"""Shared URL detection for chat reference documents."""

import re

URL_RE = re.compile(r"https?://[^\s)\]'\"<>,\u0080-\uFFFF]+")
URL_CONTEXT_ERROR_KEY = "_url_context_error"


def _should_crawl_urls(text: str, urls: list[str]) -> list[str]:
    """크롤링할 URL만 걸러냄. 코드블록/문자열 문맥 안 URL은 제외."""
    # 코드블록(``` ... ```) 범위 추출
    code_block_ranges: list[tuple[int, int]] = []
    for m in re.finditer(r'```[\s\S]*?```', text):
        code_block_ranges.append((m.start(), m.end()))

    crawlable = []
    for url in urls:
        pos = text.find(url)
        if pos == -1:
            continue
        # 코드블록 안이면 스킵
        if any(s <= pos <= e for s, e in code_block_ranges):
            continue
        # URL 직전 30자에 코드 문맥 신호(=, :, (, [, ,, ", ')가 있으면 스킵
        prefix = text[max(0, pos - 30):pos]
        if re.search(r'[=:([,"\'][ \t]*$', prefix):
            continue
        crawlable.append(url)
    return crawlable

