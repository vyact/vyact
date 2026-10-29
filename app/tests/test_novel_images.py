from io import BytesIO

import pytest
from fastapi import HTTPException, UploadFile
from PIL import Image

from services import novel_images


@pytest.mark.asyncio
async def test_image_upload_stores_valid_image_with_generated_filename(tmp_path, monkeypatch):
    monkeypatch.setattr(novel_images, 'NOVEL_IMAGES_DIR', tmp_path)
    content = BytesIO()
    Image.new('RGB', (2, 2)).save(content, format='PNG')
    content.seek(0)
    result = await novel_images.save_manuscript_image(UploadFile(filename='../../sample.png', file=content))
    filename = result['url'].split('/')[-1]
    assert filename.endswith('.png')
    with Image.open(tmp_path / filename) as stored:
        assert stored.size == (2, 2)


@pytest.mark.asyncio
@pytest.mark.parametrize('content', [b'', b'<svg onload="alert(1)"></svg>', b'not an image'])
async def test_image_upload_rejects_invalid_content(content, tmp_path, monkeypatch):
    monkeypatch.setattr(novel_images, 'NOVEL_IMAGES_DIR', tmp_path)
    with pytest.raises(HTTPException) as error:
        await novel_images.save_manuscript_image(UploadFile(filename='image.png', file=BytesIO(content)))
    assert error.value.status_code == 400
    assert not list(tmp_path.iterdir())


@pytest.mark.asyncio
async def test_cancel_deletes_only_image_with_valid_token(tmp_path, monkeypatch):
    monkeypatch.setattr(novel_images, 'NOVEL_IMAGES_DIR', tmp_path)
    content = BytesIO()
    Image.new('RGB', (2, 2)).save(content, format='PNG')
    content.seek(0)
    result = await novel_images.save_manuscript_image(UploadFile(filename='image.png', file=content))
    filename = result['url'].split('/')[-1]
    with pytest.raises(HTTPException) as error:
        novel_images.delete_manuscript_image(filename, 'incorrect-token')
    assert error.value.status_code == 403
    assert (tmp_path / filename).exists()
    novel_images.delete_manuscript_image(filename, result['deleteToken'])
    assert not list(tmp_path.iterdir())
