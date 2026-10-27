"""Chapter-by-chapter novel exports, with an offline, print-oriented PDF layout."""
import base64
import io
import re
import zipfile
from html import escape
from pathlib import Path

from playwright.async_api import async_playwright


EXPORT_FONT_DIR = Path(__file__).resolve().parents[1] / "static" / "assets"


def safe_export_name(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", title).strip(" .")[:100]
    return name or "chapter"


def chapter_html(story_title: str, chapter: dict) -> str:
    font = next(EXPORT_FONT_DIR.glob("PretendardVariable*.woff2"), None)
    font_css = ""
    if font:
        data = base64.b64encode(font.read_bytes()).decode("ascii")
        font_css = f"@font-face{{font-family:NovelExport;src:url(data:font/woff2;base64,{data}) format('woff2');font-weight:100 900}}"
    return f"""<!doctype html><html><head><meta charset="utf-8"><style>
    {font_css}
    body{{font-family:NovelExport,'Noto Sans CJK KR','Malgun Gothic','Apple SD Gothic Neo',sans-serif;color:#202020;font-size:11pt;line-height:1.9}}
    .story-title{{font-size:9pt;color:#777;margin:0 0 10mm}}
    h1{{font-size:22pt;line-height:1.45;margin:0 0 12mm;overflow-wrap:anywhere}}
    .manuscript{{white-space:pre-wrap;overflow-wrap:anywhere;orphans:3;widows:3}}
    </style></head><body><p class="story-title">{escape(story_title)}</p><h1>{escape(chapter['title'])}</h1><div class="manuscript">{escape(chapter['text'])}</div></body></html>"""


async def build_novel_export(story: dict, format: str, chapter_id: str | None = None) -> tuple[bytes, str, str]:
    chapters = [(index, chapter) for index, chapter in enumerate(story["chapters"], 1) if chapter_id is None or str(chapter["id"]) == chapter_id]
    if not chapters:
        raise ValueError("Chapter not found")
    files = []
    if format == "md":
        for index, chapter in chapters:
            files.append((f"{index:03d}_{safe_export_name(chapter['title'])}.md", f"# {chapter['title']}\n\n{chapter['text']}".encode("utf-8")))
    else:
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
            try:
                page = await browser.new_page()
                # Exports never load model-supplied URLs or external assets.
                await page.route("**/*", lambda route: route.abort())
                for index, chapter in chapters:
                    await page.set_content(chapter_html(story["title"], chapter), wait_until="load")
                    await page.evaluate("document.fonts.ready")
                    pdf = await page.pdf(format="A4", print_background=True, margin={"top": "22mm", "bottom": "22mm", "left": "22mm", "right": "22mm"}, display_header_footer=True, header_template="<span></span>", footer_template='<div style="width:100%;text-align:center;font-size:9px;color:#888"><span class="pageNumber"></span></div>')
                    files.append((f"{index:03d}_{safe_export_name(chapter['title'])}.pdf", pdf))
            finally:
                await browser.close()
    if chapter_id is not None:
        name, content = files[0]
        return content, name, "application/pdf" if format == "pdf" else "text/markdown; charset=utf-8"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files:
            archive.writestr(name, content)
    return buffer.getvalue(), f"{safe_export_name(story['title'])}_{format}.zip", "application/zip"
