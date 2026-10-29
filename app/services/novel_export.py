"""Chapter-by-chapter novel exports, with an offline, print-oriented PDF layout."""
import base64
import io
import re
import zipfile
from html import escape
from pathlib import Path

from playwright.async_api import async_playwright

from services.novel_images import NOVEL_IMAGES_DIR


EXPORT_FONT_DIR = Path(__file__).resolve().parents[1] / "static" / "assets"


def safe_export_name(title: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\x00-\x1f]', "_", title).strip(" .")[:100]
    return name or "chapter"


MANUSCRIPT_IMAGE = re.compile(r'!\[([^\]]*)\]\((/api/novel-studio/images/([a-f0-9]{32}\.(?:png|jpg|gif|webp)))\)')
IMAGE_MIME_TYPES = {'png': 'image/png', 'jpg': 'image/jpeg', 'gif': 'image/gif', 'webp': 'image/webp'}


def read_export_image(filename: str) -> bytes:
    path = NOVEL_IMAGES_DIR / filename
    if not path.is_file():
        raise ValueError('Manuscript image not found')
    return path.read_bytes()


def manuscript_html(text: str) -> str:
    fragments = []
    position = 0
    for match in MANUSCRIPT_IMAGE.finditer(text):
        fragments.append(escape(text[position:match.start()]))
        filename = match.group(3)
        data = base64.b64encode(read_export_image(filename)).decode('ascii')
        mime = IMAGE_MIME_TYPES[filename.rsplit('.', 1)[1]]
        fragments.append(f'<img src="data:{mime};base64,{data}" alt="{escape(match.group(1), quote=True)}">')
        position = match.end()
    fragments.append(escape(text[position:]))
    return ''.join(fragments)


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
    .manuscript img{{display:block;max-width:100%;max-height:230mm;object-fit:contain;margin:5mm auto;break-inside:avoid}}
    </style></head><body><p class="story-title">{escape(story_title)}</p><h1>{escape(chapter['title'])}</h1><div class="manuscript">{manuscript_html(chapter['text'])}</div></body></html>"""


async def build_novel_export(story: dict, format: str, chapter_id: str | None = None) -> tuple[bytes, str, str]:
    chapters = [(index, chapter) for index, chapter in enumerate(story["chapters"], 1) if chapter_id is None or str(chapter["id"]) == chapter_id]
    if not chapters:
        raise ValueError("Chapter not found")
    files = []
    images = {}
    if format == "md":
        for index, chapter in chapters:
            def package_image(match):
                filename = match.group(3)
                archive_path = f'images/{filename}'
                if archive_path not in images:
                    images[archive_path] = read_export_image(filename)
                return f'![{match.group(1)}]({archive_path})'
            text = MANUSCRIPT_IMAGE.sub(package_image, chapter['text'])
            files.append((f"{index:03d}_{safe_export_name(chapter['title'])}.md", f"# {chapter['title']}\n\n{text}".encode("utf-8")))
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
                    await page.evaluate("Promise.all(Array.from(document.images, image => image.decode()))")
                    pdf = await page.pdf(format="A4", print_background=True, margin={"top": "22mm", "bottom": "22mm", "left": "22mm", "right": "22mm"}, display_header_footer=True, header_template="<span></span>", footer_template='<div style="width:100%;text-align:center;font-size:9px;color:#888"><span class="pageNumber"></span></div>')
                    files.append((f"{index:03d}_{safe_export_name(chapter['title'])}.pdf", pdf))
            finally:
                await browser.close()
    if chapter_id is not None and not images:
        name, content = files[0]
        return content, name, "application/pdf" if format == "pdf" else "text/markdown; charset=utf-8"
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in [*files, *images.items()]:
            archive.writestr(name, content)
    archive_name = f"{Path(files[0][0]).stem}_md.zip" if chapter_id is not None else f"{safe_export_name(story['title'])}_{format}.zip"
    return buffer.getvalue(), archive_name, "application/zip"
