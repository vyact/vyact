"""
document_parser.py – 파일 파싱 + 청크 분할
지원 형식: pdf, docx, xlsx, pptx, txt, html/htm, md
chunk_type: paragraph | table | code | heading
"""
import re
from pathlib import Path
from typing import Iterable, NamedTuple

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


def _split_lines_with_context(lines: Iterable[str], *, context_lines: list[str], chunk_type: str,
                              heading_path: list[str] | None = None, page_number: int | None = None) -> list[Chunk]:
    """행 경계를 지키며 모든 구조화 청크에 최대 길이를 적용한다."""
    chunk_size, _ = _chunk_settings()
    context = [line for line in context_lines if line.strip()]
    prefix_length = len("\n".join(context)) + (1 if context else 0)
    output: list[Chunk] = []
    current: list[str] = []
    current_length = prefix_length

    def emit() -> None:
        if current:
            output.append(Chunk(text="\n".join([*context, *current]).strip(), chunk_type=chunk_type,
                                heading_path=list(heading_path or []), page_number=page_number))
            current.clear()

    for line in lines:
        line = line.strip()
        if not line:
            continue
        if current and current_length + len(line) + 1 > chunk_size:
            emit()
            current_length = prefix_length
        if not current and prefix_length + len(line) > chunk_size:
            available = max(1, chunk_size - prefix_length)
            for part in split_chunks(line, chunk_size=available, overlap=0):
                output.append(Chunk(text="\n".join([*context, part]).strip(), chunk_type=chunk_type,
                                    heading_path=list(heading_path or []), page_number=page_number))
            continue
        current.append(line)
        current_length += len(line) + 1
    emit()
    return output


def _table_chunks(rows: list[str], *, context_lines: list[str] | None = None,
                  heading_path: list[str] | None = None, page_number: int | None = None) -> list[Chunk]:
    """표는 행 경계에서 분할하고 제목·헤더를 모든 분할 청크에 반복한다."""
    if not rows:
        return []
    return _split_lines_with_context(rows[1:] or [rows[0]], context_lines=[*(context_lines or []), rows[0]],
                                     chunk_type="table", heading_path=heading_path, page_number=page_number)


# ─────────────────────────────
# 파서들 (텍스트만 반환 — 내부용)
# ─────────────────────────────

def _extract_pdf_body_text(page, table_bboxes: list[tuple]) -> str:
    """표를 제외한 PDF 본문을 읽기 순서대로 추출한다.

    중앙 여백이 뚜렷한 페이지는 좌측 열 전체 후 우측 열 전체를 읽는다. 단일 열
    문서나 넓은 표제/초록이 있는 페이지는 기존의 위→아래 추출을 유지한다.
    """
    try:
        body_page = page.filter(
            lambda obj: obj["object_type"] == "char" and not any(
                bbox[0] <= obj["x0"] <= bbox[2] and bbox[1] <= obj["top"] <= bbox[3]
                for bbox in table_bboxes
            )
        ) if table_bboxes else page
        words = body_page.extract_words()
        if not words:
            return ""

        page_midpoint = page.width / 2
        left_words = [word for word in words if word["x1"] < page.width * 0.48]
        right_words = [word for word in words if word["x0"] > page.width * 0.52]
        center_words = [word for word in words if page.width * 0.45 <= (word["x0"] + word["x1"]) / 2 <= page.width * 0.55]
        has_two_columns = (
            len(left_words) >= 30 and len(right_words) >= 30
            and len(center_words) * 12 < min(len(left_words), len(right_words))
        )
        if has_two_columns:
            left_text = body_page.crop((0, 0, page_midpoint, page.height)).extract_text() or ""
            right_text = body_page.crop((page_midpoint, 0, page.width, page.height)).extract_text() or ""
            return "\n".join(part for part in (left_text, right_text) if part.strip())
        return body_page.extract_text() or ""
    except Exception:
        return page.extract_text() or ""

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
    previous_table_header: list[str] = []

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
                column_count = len(rows[0].split(" | ")) if rows else 0
                first_row_has_value = bool(re.search(r"\d", rows[0])) if rows else False
                is_continuation = (
                    previous_table_header and column_count == len(previous_table_header)
                    and first_row_has_value
                )
                if is_continuation:
                    chunks.extend(_split_lines_with_context(rows, context_lines=previous_table_header,
                                                            chunk_type="table", heading_path=current_headings,
                                                            page_number=page_num))
                else:
                    chunks.extend(_table_chunks(rows, heading_path=current_headings, page_number=page_num))
                    previous_table_header = rows[0].split(" | ")

            # 2) 표 영역을 제외하고 단일/다단 레이아웃에 맞춰 본문을 추출
            page_text = _extract_pdf_body_text(page, table_bboxes)

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
    """DOCX의 문단·표 순서와 병합 셀을 보존해 청킹한다."""
    from docx import Document
    from docx.oxml.table import CT_Tbl
    from docx.oxml.text.paragraph import CT_P
    from docx.table import Table
    from docx.text.paragraph import Paragraph
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

    def append_table(table: Table) -> None:
        rows = []
        for row in table.rows:
            seen_cells = set()
            values = []
            for cell in row.cells:
                cell_id = id(cell._tc)
                if cell_id in seen_cells:
                    continue
                seen_cells.add(cell_id)
                if cell.text.strip():
                    values.append(cell.text.strip())
            if values:
                rows.append(" | ".join(values))
        chunks.extend(_table_chunks(rows, heading_path=heading_stack))

    for child in doc.element.body.iterchildren():
        if isinstance(child, CT_Tbl):
            flush_para()
            append_table(Table(child, doc))
            continue
        if not isinstance(child, CT_P):
            continue
        para = Paragraph(child, doc)
        t = para.text.strip()
        if not t:
            continue
        style_name = para.style.name if para.style else ""
        style = style_name.lower()
        is_heading = style in HEADING_STYLES or style.startswith("heading")
        if is_heading:
            flush_para()
            # 레벨 파악 (Heading 1 → 레벨 1)
            level = 1
            try:
                level = int(style_name.split()[-1])
            except (ValueError, IndexError):
                pass
            # 상위 레벨 이후 항목 제거하고 현재 추가
            heading_stack[level - 1:] = [t]
            chunks.append(Chunk(text=t, chunk_type="heading", heading_path=list(heading_stack)))
        else:
            para_buf.append(t)

    flush_para()

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
    wb = openpyxl.load_workbook(str(path), read_only=False, data_only=False)
    chunks: list[Chunk] = []

    for sheet in wb.worksheets:
        rows: list[str] = []
        for row_index, row in enumerate(sheet.iter_rows(), start=1):
            cells = [str(cell.value).strip() for cell in row if cell.value is not None and str(cell.value).strip()]
            if cells:
                rows.append(f"[행: {row_index}] " + " | ".join(cells))

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


def _parse_pptx_chunks(path: Path) -> list[Chunk]:
    """슬라이드 경계를 넘지 않고 제목을 분할 청크의 문맥으로 유지한다."""
    from pptx import Presentation

    presentation = Presentation(str(path))
    chunks: list[Chunk] = []
    for slide_number, slide in enumerate(presentation.slides, start=1):
        shapes = sorted((shape for shape in slide.shapes if shape.has_text_frame), key=lambda shape: (shape.top, shape.left))
        lines = [paragraph.text.strip() for shape in shapes for paragraph in shape.text_frame.paragraphs if paragraph.text.strip()]
        if not lines:
            continue
        title = lines[0]
        chunks.extend(_split_lines_with_context(lines[1:] or [title], context_lines=[f"[슬라이드 {slide_number}]", title],
                                                chunk_type="paragraph", heading_path=[title], page_number=slide_number))
    return chunks


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
        # Markdown 수평선은 문서 구조를 나누는 표식일 뿐 검색 대상이 아니다.
        if re.fullmatch(r"\s{0,3}([-*_])(?:\s*\1){2,}\s*", line):
            flush_para()
            flush_table()
            continue
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
        if sent_len > chunk_size:
            if current:
                chunks.append(" ".join(current))
                current, current_len = [], 0
            # 문장 내부에 자연스러운 경계가 없을 때만 최후 수단으로 길이를 강제한다.
            for start in range(0, sent_len, chunk_size):
                chunks.append(sent[start:start + chunk_size].strip())
            continue
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
    ".pptx": _parse_pptx_chunks,
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
            # 모든 블록 유형에 최대 길이를 적용하고 메타데이터를 보존한다.
            result: list[Chunk] = []
            chunk_size, _ = _chunk_settings()
            for chunk in chunks:
                if len(chunk.text) > chunk_size:
                    if chunk.chunk_type == "table":
                        rows = [line for line in chunk.text.splitlines() if line.strip()]
                        context_lines = []
                        if rows and rows[0].startswith("[시트:"):
                            context_lines.append(rows.pop(0))
                        result.extend(_table_chunks(rows, context_lines=context_lines, heading_path=chunk.heading_path, page_number=chunk.page_number))
                    elif chunk.chunk_type == "code":
                        result.extend(_split_lines_with_context(chunk.text.splitlines(), context_lines=[], chunk_type="code", heading_path=chunk.heading_path, page_number=chunk.page_number))
                    else:
                        for sub in split_chunks(chunk.text):
                            result.append(Chunk(text=sub, chunk_type=chunk.chunk_type, heading_path=chunk.heading_path, page_number=chunk.page_number))
                else:
                    result.append(chunk)
            logger.info("typed 청크 분할: %s → %d개", path.name, len(result))
            return result
        except Exception as e:
            logger.warning("typed 파싱 실패, fallback: %s", e)

    # fallback: 일반 텍스트 파싱
    text = parse_file(path)
    return _text_to_chunks(text)
