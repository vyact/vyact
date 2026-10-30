"""Persistent image attachments for manuscript Markdown."""
from io import BytesIO
import re
import secrets
from uuid import uuid4

from fastapi import HTTPException, UploadFile
from PIL import Image, UnidentifiedImageError
from starlette.concurrency import run_in_threadpool

from config import INSTALL_DIR

NOVEL_IMAGES_DIR = INSTALL_DIR / 'uploads' / 'novel_images'
MAX_IMAGE_BYTES = 10 * 1024 * 1024
IMAGE_FORMATS = {'PNG': 'png', 'JPEG': 'jpg', 'GIF': 'gif', 'WEBP': 'webp'}


async def save_manuscript_image(file: UploadFile) -> dict:
    content = await file.read(MAX_IMAGE_BYTES + 1)
    if not content or len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(status_code=400, detail='Invalid image size')
    return await run_in_threadpool(_store_manuscript_image, content)


def _store_manuscript_image(content: bytes) -> dict:
    try:
        with Image.open(BytesIO(content)) as image:
            extension = IMAGE_FORMATS.get(image.format)
            image.verify()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
        raise HTTPException(status_code=400, detail='Invalid image')
    if not extension:
        raise HTTPException(status_code=400, detail='Unsupported image format')
    NOVEL_IMAGES_DIR.mkdir(parents=True, exist_ok=True)
    filename = f'{uuid4().hex}.{extension}'
    (NOVEL_IMAGES_DIR / filename).write_bytes(content)
    delete_token = secrets.token_urlsafe(32)
    (NOVEL_IMAGES_DIR / f'{filename}.token').write_text(delete_token)
    return {'url': f'/api/novel-studio/images/{filename}', 'deleteToken': delete_token}


def delete_manuscript_image(filename: str, token: str) -> None:
    if not re.fullmatch(r'[a-f0-9]{32}\.(png|jpg|gif|webp)', filename):
        raise HTTPException(status_code=404, detail='Image not found')
    token_path = NOVEL_IMAGES_DIR / f'{filename}.token'
    if not token_path.is_file():
        raise HTTPException(status_code=404, detail='Image not found')
    if not secrets.compare_digest(token_path.read_text(), token):
        raise HTTPException(status_code=403, detail='Invalid deletion token')
    (NOVEL_IMAGES_DIR / filename).unlink(missing_ok=True)
    token_path.unlink(missing_ok=True)

