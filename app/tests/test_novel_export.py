import io
import zipfile
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from services.novel_export import build_novel_export, chapter_html, manuscript_text_html, safe_export_name
from routers.novel_studio import NovelExportRequest, NovelStory, NovelChapter, export_novel
from fastapi import HTTPException


def sample_story():
    return {'id': str(uuid4()), 'title': '밤의 도서관', 'bible': '', 'chapters': [
        {'id': str(uuid4()), 'title': '같은 제목', 'text': '첫 번째 회차\n\n본문을 보존합니다.'},
        {'id': str(uuid4()), 'title': '같은 제목', 'text': '두 번째 회차'},
    ]}


def test_pdf_renders_inline_code_instead_of_literal_backticks():
    html = chapter_html('Story', {'title': 'Chapter', 'text': '메모\n\n`외인 3일 연속 순매수 / 프로그램 비중 3.2배`\n\n`가설: 확인 필요.`'})
    assert '<code>외인 3일 연속 순매수 / 프로그램 비중 3.2배</code>' in html
    assert '<code>가설: 확인 필요.</code>' in html
    assert '`' not in html


def test_pdf_code_spans_escape_html_and_preserve_literal_backticks():
    assert manuscript_text_html('`<script> & text`') == '<code>&lt;script&gt; &amp; text</code>'
    assert manuscript_text_html('`` a ` b ``') == '<code>a ` b</code>'
    assert manuscript_text_html('unmatched ` text') == 'unmatched ` text'


@pytest.mark.asyncio
async def test_whole_story_is_a_zip_with_one_file_per_chapter_in_order():
    story = sample_story()
    content, filename, media_type = await build_novel_export(story, 'md')
    assert filename == '밤의 도서관_md.zip'
    assert media_type == 'application/zip'
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert archive.namelist() == ['001_같은 제목.md', '002_같은 제목.md']
        assert archive.read(archive.namelist()[0]).decode('utf-8') == '# 같은 제목\n\n첫 번째 회차\n\n본문을 보존합니다.'
        assert archive.read(archive.namelist()[1]).decode('utf-8').endswith('두 번째 회차')


@pytest.mark.asyncio
async def test_single_chapter_is_not_zipped_and_contains_only_that_chapter():
    story = sample_story()
    content, filename, media_type = await build_novel_export(story, 'md', story['chapters'][1]['id'])
    assert filename == '002_같은 제목.md'
    assert media_type.startswith('text/markdown')
    assert '첫 번째' not in content.decode('utf-8')
    assert '두 번째 회차' in content.decode('utf-8')


def test_pdf_template_escapes_untrusted_manuscript_and_filenames_cannot_escape_archive():
    html = chapter_html('<script>title</script>', {'title': '<b>Title</b>', 'text': '<script>alert(1)</script>\nA & B'})
    assert '<script>' not in html
    assert '&lt;script&gt;' in html
    assert 'white-space:pre-wrap' in html
    assert '/' not in safe_export_name('../../escape/name')


@pytest.mark.asyncio
async def test_export_route_returns_download_headers_and_rejects_unknown_chapters():
    story = NovelStory.model_validate(sample_story())
    body = NovelExportRequest(story=story, format='pdf', chapter_id=story.chapters[0].id)
    with patch('routers.novel_studio.build_novel_export', new=AsyncMock(return_value=(b'%PDF-test', '제1화.pdf', 'application/pdf'))):
        response = await export_novel(body)
    assert response.body.startswith(b'%PDF')
    assert "filename*=UTF-8''" in response.headers['content-disposition']
    body.chapter_id = uuid4()
    with pytest.raises(HTTPException) as error:
        await export_novel(body)
    assert error.value.status_code == 404


@pytest.mark.asyncio
async def test_markdown_images_are_packaged_with_relative_paths_and_deduplicated(tmp_path, monkeypatch):
    monkeypatch.setattr('services.novel_export.NOVEL_IMAGES_DIR', tmp_path)
    filename = 'a' * 32 + '.png'
    (tmp_path / filename).write_bytes(b'image-content')
    story = sample_story()
    story['chapters'][0]['text'] = f'Before\n![scene](/api/novel-studio/images/{filename})\n![](/api/novel-studio/images/{filename})\nAfter'
    content, name, media_type = await build_novel_export(story, 'md', story['chapters'][0]['id'])
    assert name.endswith('_md.zip')
    assert media_type == 'application/zip'
    with zipfile.ZipFile(io.BytesIO(content)) as archive:
        assert len(archive.namelist()) == 2
        assert archive.read(f'images/{filename}') == b'image-content'
        text = archive.read(archive.namelist()[0]).decode()
        assert f'![scene](images/{filename})' in text
        assert '/api/' not in text
        assert text.endswith('After')


def test_pdf_embeds_only_local_manuscript_images_without_loading_external_urls(tmp_path, monkeypatch):
    monkeypatch.setattr('services.novel_export.NOVEL_IMAGES_DIR', tmp_path)
    filename = 'b' * 32 + '.png'
    (tmp_path / filename).write_bytes(b'image-content')
    html = chapter_html('Story', {'title': 'Chapter', 'text': f'Before\n![scene](/api/novel-studio/images/{filename})\nAfter\n![](https://example.com/image.png)\n<script>bad</script>'})
    assert '<img src="data:image/png;base64,' in html
    assert 'Before' in html and 'After' in html
    assert '<script>' not in html
    assert '<img src="https:' not in html


@pytest.mark.asyncio
async def test_export_reports_missing_image_instead_of_silently_omitting_it():
    story = sample_story()
    story['chapters'][0]['text'] = '![](/api/novel-studio/images/' + '0' * 32 + '.png)'
    with pytest.raises(ValueError, match='image not found'):
        await build_novel_export(story, 'md')


def test_story_pin_timestamp_survives_serialization_and_unpinning():
    source = sample_story()
    source['pinnedAt'] = 1793270000000
    story = NovelStory.model_validate(source)
    assert NovelStory.model_validate(story.model_dump(mode='json')).pinnedAt == source['pinnedAt']
    story.pinnedAt = None
    assert story.model_dump(mode='json')['pinnedAt'] is None


def test_pdf_preserves_resized_image_width(tmp_path, monkeypatch):
    monkeypatch.setattr('services.novel_export.NOVEL_IMAGES_DIR', tmp_path)
    filename = 'd' * 32 + '.png'
    (tmp_path / filename).write_bytes(b'image')
    html = chapter_html('Story', {'title': 'Chapter', 'text': f'![](/api/novel-studio/images/{filename}?width=320)'})
    assert '<img width="320" src="data:image/png;base64,' in html
