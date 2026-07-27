"""
document_parser.py – 파일 파싱 + 청크 분할
지원 형식: pdf, docx, xlsx, pptx, txt, html/htm, md
chunk_type: paragraph | table | code | heading
"""
import re
from pathlib import Path
from typing import NamedTuple

from logger import get_logger
from services.runtime_settings import get_runtime_settings

logger = get_logger(__name__)

CHUNK_SIZE = 1200
CHUNK_OVERLAP = 150


def _chunk_settings() -> tuple[int, int]:
    settings = get_runtime_settings()
    return settings["document_chunk_size"], settings["document_chunk_overlap"]


class Chunk(NamedTuple):
    text: str
    chunk_type: str          # paragraph | table | code | heading
    heading_path: list[str] = []   # 소속 heading 경로 ["1. 서론", "1.1 배경"]
    page_number: int | None = None  # PDF 페이지 번호 (1-based)


# ─────────────────────────────
# 파서들 (텍스트만 반환 — 내부용)
# ─────────────────────────────

def _parse_pdf_chunks(path: Path) -> list[Chunk]:
    """pdfplumber로 표/텍스트/코드/제목 구분 청크 생성"""
    try:
        import pdfplumber
    except ImportError:
        import pypdf
        reader = pypdf.PdfReader(str(path))
        text = "\n\n".join(p.extract_text() or "" for p in reader.pages)
        return _text_to_chunks(text)

    chunks: list[Chunk] = []
    current_headings: list[str] = []  # 현재 heading 경로 스택

    with pdfplumber.open(path) as pdf:
        for page_num, page in enumerate(pdf.pages, start=1):
            # 1) 표 추출
            tables = page.extract_tables()
            table_bboxes = [t.bbox for t in page.find_tables()] if hasattr(page, "find_tables") else []

            for table in tables:
                rows = []
                for row in table:
                    cells = [str(c).strip() if c else "" for c in row]
                    if any(cells):
                        rows.append(" | ".join(cells))
                if rows:
                    chunks.append(Chunk(
                        text="\n".join(rows),
                        chunk_type="table",
                        heading_path=list(current_headings),
                        page_number=page_num,
                    ))

            # 2) 표 영역 제외한 텍스트 추출
            if table_bboxes:
                try:
                    page_text = page.filter(
                        lambda obj: obj["object_type"] == "char" and
                                    not any(
                                        bbox[0] <= obj["x0"] <= bbox[2] and
                                        bbox[1] <= obj["top"] <= bbox[3]
                                        for bbox in table_bboxes
                                    )
                    ).extract_text()
                except Exception:
                    page_text = page.extract_text()
            else:
                page_text = page.extract_text()

            if not page_text:
                continue

            # 3) 줄 단위 분석 → heading 경로 추적
            for raw_chunk in _classify_text_lines_with_context(page_text, current_headings, page_num):
                chunks.append(raw_chunk)

    return chunks


def _classify_text_lines_with_context(
        text: str,
        heading_stack: list[str],
        page_num: int | None = None,
) -> list[Chunk]:
    """텍스트를 줄 단위로 분석 + heading 경로 추적"""
    chunks: list[Chunk] = []
    lines = text.split("\n")

    code_buf: list[str] = []
    para_buf: list[str] = []

    CODE_PATTERNS = re.compile(
        r"^(def |class |import |from |public |private |protected |function |const |let |var |return |if |for |while |{|}|#include|package |@)"
    )
    HEADING_PATTERN = re.compile(
        r"^("
        r"#{1,4}\s"                       # 마크다운 헤딩: ## 제목
        r"|\d+\.\s{1,3}\S"               # 번호 헤딩: 1. 제목
        r"|제\d+[장절]"                    # 한국어 장/절: 제1장
        r"|[A-Z][A-Za-z\s]{8,}$"         # 혼합 대소문자 긴 제목 (8자 이상, KRW/BIS 등 약어 제외)
        r")"
    )

    def flush_para():
        t = " ".join(para_buf).strip()
        if t:
            chunks.append(Chunk(
                text=t, chunk_type="paragraph",
                heading_path=list(heading_stack),
                page_number=page_num,
            ))
        para_buf.clear()

    def flush_code():
        t = "\n".join(code_buf).strip()
        if t:
            chunks.append(Chunk(
                text=t, chunk_type="code",
                heading_path=list(heading_stack),
                page_number=page_num,
            ))
        code_buf.clear()

    pending_heading: str | None = None

    for line in lines:
        stripped = line.strip()
        if not stripped:
            if code_buf:
                flush_code()
            elif para_buf:
                flush_para()
            continue

        if CODE_PATTERNS.match(stripped):
            if para_buf:
                flush_para()
            code_buf.append(stripped)
        elif HEADING_PATTERN.match(stripped) and len(stripped) < 80:
            if code_buf:
                flush_code()
            if para_buf:
                flush_para()
            # heading_stack 업데이트: 간단히 최대 3레벨 유지
            heading_stack.clear()
            heading_stack.append(stripped)
            chunks.append(Chunk(
                text=stripped, chunk_type="heading",
                heading_path=list(heading_stack),
                page_number=page_num,
            ))
        else:
            if code_buf:
                flush_code()
            if pending_heading:
                para_buf.append(pending_heading)
                pending_heading = None
            para_buf.append(stripped)

    if pending_heading:
        chunks.append(Chunk(
            text=pending_heading, chunk_type="heading",
            heading_path=list(heading_stack),
            page_number=page_num,
        ))
    flush_code()
    flush_para()
    return chunks


def _classify_text_lines(text: str) -> list[Chunk]:
    """텍스트를 줄 단위로 분석해 heading/code/paragraph 청크로 분류 (하위 호환)"""
    heading_stack: list[str] = []
    return _classify_text_lines_with_context(text, heading_stack)


def _text_to_chunks(text: str) -> list[Chunk]:
    """일반 텍스트 → paragraph 청크 리스트"""
    return [Chunk(text=c, chunk_type="paragraph") for c in split_chunks(text) if c.strip()]


def _parse_docx_chunks(path: Path) -> list[Chunk]:
    from docx import Document
    doc = Document(str(path))
    chunks: list[Chunk] = []
    para_buf: list[str] = []
    heading_stack: list[str] = []

    HEADING_STYLES = {"heading 1", "heading 2", "heading 3", "heading 4", "제목 1", "제목 2"}

    def flush_para():
        t = " ".join(para_buf).strip()
        if t:
            for c in split_chunks(t):
                chunks.append(Chunk(text=c, chunk_type="paragraph", heading_path=list(heading_stack)))
        para_buf.clear()

    for para in doc.paragraphs:
        t = para.text.strip()
        if not t:
            continue
        style = para.style.name.lower() if para.style else ""
        is_heading = style in HEADING_STYLES or para.style.name.startswith("Heading")
        if is_heading:
            flush_para()
            # 레벨 파악 (Heading 1 → 레벨 1)
            level = 1
            try:
                level = int(para.style.name.split()[-1])
            except (ValueError, IndexError):
                pass
            # 상위 레벨 이후 항목 제거하고 현재 추가
            heading_stack[level - 1:] = [t]
            chunks.append(Chunk(text=t, chunk_type="heading", heading_path=list(heading_stack)))
        else:
            para_buf.append(t)

    flush_para()

    # 표
    for table in doc.tables:
        rows = []
        for row in table.rows:
            row_text = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
            if row_text:
                rows.append(row_text)
        if rows:
            chunks.append(Chunk(text="\n".join(rows), chunk_type="table", heading_path=list(heading_stack)))

    return chunks


def _parse_pdf(path: Path) -> str:
    try:
        import pdfplumber
        texts = []
        with pdfplumber.open(path) as pdf:
            for page in pdf.pages:
                t = page.extract_text()
                if t:
                    texts.append(t.strip())
        return "\n\n".join(texts)
    except ImportError:
        import pypdf
        reader = pypdf.PdfReader(str(path))
        return "\n\n".join(p.extract_text() or "" for p in reader.pages)


def _parse_docx(path: Path) -> str:
    from docx import Document
    doc = Document(str(path))
    parts = []
    for para in doc.paragraphs:
        t = para.text.strip()
        if t:
            parts.append(t)
    for table in doc.tables:
        for row in table.rows:
            row_text = " | ".join(c.text.strip() for c in row.cells if c.text.strip())
            if row_text:
                parts.append(row_text)
    return "\n".join(parts)


def _parse_xlsx(path: Path) -> str:
    """하위 호환용 — typed 청크에서 텍스트만 추출"""
    chunks = _parse_xlsx_chunks(path)
    return "\n\n".join(c.text for c in chunks)


def _parse_xlsx_chunks(path: Path) -> list["Chunk"]:
    """xlsx → 시트 단위 table 청크 분할
    - None 셀 제거
    - 시트마다 독립 table 청크
    - 행이 많으면 TABLE_ROW_LIMIT 기준으로 분할
    - search_text: 헤더+값 자연어 변환 (embedding/BM25 품질 향상)
    """
    TABLE_ROW_LIMIT = 80  # 청크당 최대 행 수

    import openpyxl
    wb = openpyxl.load_workbook(str(path), read_only=True, data_only=True)
    chunks: list[Chunk] = []

    for sheet in wb.worksheets:
        rows: list[str] = []
        for row in sheet.iter_rows(values_only=True):
            cells = [str(c).strip() for c in row if c is not None and str(c).strip()]
            if cells:
                rows.append(" | ".join(cells))

        if not rows:
            continue

        header = rows[0]
        header_cols = [c.strip() for c in header.split(" | ")]
        data_rows = rows[1:]

        def make_search_text(data_batch: list[str]) -> str:
            """헤더+값을 "컬럼명은 값이다" 형태 자연어로 변환"""
            lines = []
            for row_str in data_batch[:10]:  # 최대 10행만 변환 (길이 제한)
                vals = [v.strip() for v in row_str.split(" | ")]
                parts = [f"{col} {val}" for col, val in zip(header_cols, vals) if val]
                if parts:
                    lines.append(", ".join(parts))
            return "\n".join(lines)

        def make_chunk(title_prefix: str, row_batch: list[str], batch_data: list[str]) -> None:
            """청크 생성 — content_length가 CHUNK_SIZE*3 초과 시 2차 분할"""
            text = f"{title_prefix}\n" + "\n".join(row_batch)
            search_text = make_search_text(batch_data)
            full_text = text + (f"\n[검색용]\n{search_text}" if search_text else "")
            max_len = _chunk_settings()[0] * 3
            if len(full_text) > max_len:
                # split_chunks로 먼저 시도 (문장 단위)
                subs = split_chunks(full_text, chunk_size=max_len)
                # split_chunks가 분리 못한 경우(결과 중 max_len 초과 청크 있음) → 강제 행 단위 분할
                if any(len(s) > max_len for s in subs):
                    lines = full_text.split("\n")
                    buf, buf_len = [], 0
                    for line in lines:
                        line_len = len(line) + 1
                        if buf and buf_len + line_len > max_len:
                            chunks.append(Chunk(text="\n".join(buf), chunk_type="table"))
                            buf, buf_len = [], 0
                        buf.append(line)
                        buf_len += line_len
                    if buf:
                        chunks.append(Chunk(text="\n".join(buf), chunk_type="table"))
                else:
                    for sub in subs:
                        chunks.append(Chunk(text=sub, chunk_type="table"))
            else:
                chunks.append(Chunk(text=full_text, chunk_type="table"))

        if len(rows) <= TABLE_ROW_LIMIT:
            make_chunk(f"[시트: {sheet.title}]", rows, data_rows)
        else:
            for i in range(0, len(data_rows), TABLE_ROW_LIMIT - 1):
                batch = data_rows[i: i + TABLE_ROW_LIMIT - 1]
                part_num = i // (TABLE_ROW_LIMIT - 1) + 1
                make_chunk(f"[시트: {sheet.title} ({part_num}부)]", [header] + batch, batch)

    return chunks


def _parse_pptx(path: Path) -> str:
    from pptx import Presentation
    prs = Presentation(str(path))
    parts = []
    for i, slide in enumerate(prs.slides, 1):
        slide_texts = []
        for shape in slide.shapes:
            if shape.has_text_frame:
                for para in shape.text_frame.paragraphs:
                    t = para.text.strip()
                    if t:
                        slide_texts.append(t)
        if slide_texts:
            parts.append(f"[슬라이드 {i}]\n" + "\n".join(slide_texts))
    return "\n\n".join(parts)


def _parse_txt(path: Path) -> str:
    for enc in ("utf-8", "utf-8-sig", "cp949", "euc-kr"):
        try:
            return path.read_text(encoding=enc)
        except (UnicodeDecodeError, LookupError):
            continue
    return path.read_text(encoding="utf-8", errors="replace")


def _parse_html(path: Path) -> str:
    from bs4 import BeautifulSoup
    raw = _parse_txt(path)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()
    return soup.get_text(separator="\n", strip=True)


def _parse_html_chunks(path: Path) -> list["Chunk"]:
    """HTML → heading / table / code / paragraph 청크 분할"""
    from bs4 import BeautifulSoup, Tag
    raw = _parse_txt(path)
    soup = BeautifulSoup(raw, "html.parser")
    for tag in soup(["script", "style", "nav", "footer", "header"]):
        tag.decompose()

    chunks: list[Chunk] = []
    para_buf: list[str] = []

    def flush_para():
        t = " ".join(para_buf).strip()
        if t:
            for c in split_chunks(t):
                chunks.append(Chunk(text=c, chunk_type="paragraph"))
        para_buf.clear()

    root = soup.body if soup.body else soup
    for el in root.children:
        if not isinstance(el, Tag):
            continue

        if el.name in ("h1", "h2", "h3", "h4", "h5", "h6"):
            flush_para()
            t = el.get_text(strip=True)
            if t:
                chunks.append(Chunk(text=t, chunk_type="heading"))

        elif el.name == "table":
            flush_para()
            rows = []
            for tr in el.find_all("tr"):
                cells = [td.get_text(strip=True) for td in tr.find_all(["td", "th"])]
                cells = [c for c in cells if c]
                if cells:
                    rows.append(" | ".join(cells))
            if rows:
                chunks.append(Chunk(text="\n".join(rows), chunk_type="table"))

        elif el.name in ("pre", "code"):
            flush_para()
            t = el.get_text(strip=True)
            if t:
                chunks.append(Chunk(text=t, chunk_type="code"))

        else:
            t = el.get_text(separator=" ", strip=True)
            if t:
                para_buf.append(t)

    flush_para()
    return chunks


def _parse_md(path: Path) -> str:
    return _parse_txt(path)


def _parse_md_chunks(path: Path) -> list["Chunk"]:
    """마크다운 → heading / table / code / paragraph 청크 분할"""
    text = _parse_txt(path)
    chunks: list[Chunk] = []

    code_buf: list[str] = []
    table_buf: list[str] = []
    para_buf: list[str] = []
    in_code_block = False
    heading_stack: list[str] = []  # 인덱스 = 레벨-1

    def flush_para():
        t = " ".join(para_buf).strip()
        if t:
            for c in split_chunks(t):
                chunks.append(Chunk(text=c, chunk_type="paragraph", heading_path=list(heading_stack)))
        para_buf.clear()

    def flush_table():
        rows = [r for r in table_buf if not re.match(r"^\|[\s\-|:]+\|$", r.strip())]
        if rows:
            chunks.append(Chunk(text="\n".join(rows), chunk_type="table", heading_path=list(heading_stack)))
        table_buf.clear()

    def flush_code():
        t = "\n".join(code_buf).strip()
        if t:
            chunks.append(Chunk(text=t, chunk_type="code", heading_path=list(heading_stack)))
        code_buf.clear()

    for line in text.split("\n"):
        if line.strip().startswith("```"):
            if in_code_block:
                flush_code()
                in_code_block = False
            else:
                flush_para()
                flush_table()
                in_code_block = True
            continue

        if in_code_block:
            code_buf.append(line)
            continue

        if line.strip().startswith("|"):
            if para_buf:
                flush_para()
            table_buf.append(line.strip())
            continue
        else:
            if table_buf:
                flush_table()

        heading_match = re.match(r"^(#{1,6})\s+(.+)", line)
        if heading_match:
            flush_para()
            level = len(heading_match.group(1))
            h_text = line.strip()
            # 해당 레벨 이후 제거 후 현재 추가
            heading_stack[level - 1:] = [h_text]
            chunks.append(Chunk(text=h_text, chunk_type="heading", heading_path=list(heading_stack)))
            continue

        if not line.strip():
            if para_buf:
                flush_para()
            continue

        para_buf.append(line.strip())

    if in_code_block:
        flush_code()
    flush_table()
    flush_para()

    return chunks


# ─────────────────────────────
# 청크 분할
# ─────────────────────────────

def split_chunks(text: str, chunk_size: int | None = None, overlap: int | None = None) -> list[str]:
    """문장 경계 기준 청크 분할 — 한국어 종결어미 포함"""
    default_size, default_overlap = _chunk_settings()
    chunk_size = default_size if chunk_size is None else chunk_size
    overlap = default_overlap if overlap is None else overlap
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    if len(text) <= chunk_size:
        return [text] if text else []

    # 한국어 종결어미 + 영문 문장부호 + 단락 경계
    sentences = re.split(
        r"(?<=[.!?。])\s+"           # 영문 문장부호 뒤 공백
        r"|(?<=다\.)\s+"             # ~다.
        r"|(?<=요\.)\s+"             # ~요.
        r"|(?<=죠\.)\s+"             # ~죠.
        r"|(?<=까\.)\s+"             # ~까.
        r"|(?<=니다\.)\s+"           # ~니다.
        r"|(?<=군요\.)\s+"           # ~군요.
        r"|(?<=네요\.)\s+"           # ~네요.
        r"|\n{2,}",                  # 단락 경계
        text
    )
    sentences = [s.strip() for s in sentences if s.strip()]

    chunks = []
    current = []
    current_len = 0

    for sent in sentences:
        sent_len = len(sent)
        if current_len + sent_len > chunk_size and current:
            chunk_text = " ".join(current)
            chunks.append(chunk_text)
            # overlap: 문자 슬라이싱 대신 마지막 문장 단위로
            overlap_sents = []
            overlap_len = 0
            for s in reversed(current):
                if overlap_len + len(s) > overlap:
                    break
                overlap_sents.insert(0, s)
                overlap_len += len(s)
            current = overlap_sents + [sent]
            current_len = overlap_len + sent_len
        else:
            current.append(sent)
            current_len += sent_len

    if current:
        chunks.append(" ".join(current))

    return [c for c in chunks if c.strip()]


# ─────────────────────────────
# 메인 파서
# ─────────────────────────────

PARSERS = {
    ".pdf": _parse_pdf,
    ".docx": _parse_docx,
    ".xlsx": _parse_xlsx,
    ".pptx": _parse_pptx,
    ".txt": _parse_txt,
    ".html": _parse_html,
    ".htm": _parse_html,
    ".md": _parse_md,
}

# chunk_type 지원 파서
CHUNK_PARSERS = {
    ".pdf":  _parse_pdf_chunks,
    ".docx": _parse_docx_chunks,
    ".xlsx": _parse_xlsx_chunks,
    ".html": _parse_html_chunks,
    ".htm":  _parse_html_chunks,
    ".md":   _parse_md_chunks,
}


def parse_file(path: Path) -> str:
    """파일 파싱 → 전체 텍스트 반환"""
    ext = path.suffix.lower()
    parser = PARSERS.get(ext)
    if not parser:
        raise ValueError(f"지원하지 않는 형식: {ext}")
    try:
        text = parser(path)
        logger.info("파싱 완료: %s (%d자)", path.name, len(text))
        return text
    except Exception as e:
        logger.error("파싱 실패 [%s]: %s", path.name, e)
        raise


def parse_file_to_chunks(path: Path) -> list[str]:
    """파일 파싱 → 텍스트 청크 리스트 반환 (하위 호환)"""
    chunks = parse_file_to_typed_chunks(path)
    return [c.text for c in chunks]


def parse_file_to_typed_chunks(path: Path) -> list[Chunk]:
    """파일 파싱 → (text, chunk_type) 청크 리스트 반환"""
    ext = path.suffix.lower()
    if ext in CHUNK_PARSERS:
        try:
            chunks = CHUNK_PARSERS[ext](path)
            # chunk_size 초과 청크 분할
            result: list[Chunk] = []
            chunk_size, _ = _chunk_settings()
            for chunk in chunks:
                if len(chunk.text) > chunk_size and chunk.chunk_type == "paragraph":
                    for sub in split_chunks(chunk.text):
                        result.append(Chunk(text=sub, chunk_type="paragraph"))
                else:
                    result.append(chunk)
            logger.info("typed 청크 분할: %s → %d개", path.name, len(result))
            return result
        except Exception as e:
            logger.warning("typed 파싱 실패, fallback: %s", e)

    # fallback: 일반 텍스트 파싱
    text = parse_file(path)
    return _text_to_chunks(text)
