import io
import zipfile
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest
from services.novel_export import build_novel_export, chapter_html, safe_export_name
from routers.novel_studio import NovelExportRequest, NovelStory, NovelChapter, export_novel
from fastapi import HTTPException


def sample_story():
    return {'id': str(uuid4()), 'title': '밤의 도서관', 'bible': '', 'chapters': [
        {'id': str(uuid4()), 'title': '같은 제목', 'text': '첫 번째 회차\n\n본문을 보존합니다.'},
        {'id': str(uuid4()), 'title': '같은 제목', 'text': '두 번째 회차'},
    ]}


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
