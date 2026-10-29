import io
import json
import zipfile
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import UploadFile

from routers import backup
from services import plugin_manager


@pytest.mark.asyncio
async def test_novel_images_round_trip_without_document_files(tmp_path, monkeypatch):
    source = tmp_path / 'source'
    source.mkdir()
    image_name = 'a' * 32 + '.png'
    (source / image_name).write_bytes(b'image-data')
    (source / f'{image_name}.token').write_text('private-token')
    monkeypatch.setattr(backup, 'NOVEL_IMAGES_DIR', source)
    monkeypatch.setattr(backup, 'DOCS_DIR', tmp_path / 'documents')
    monkeypatch.setattr(backup, 'MEMO_ATTACHMENTS_DIR', tmp_path / 'memos')
    es = AsyncMock()
    monkeypatch.setattr(backup, 'get_es', Mock(return_value=es))
    monkeypatch.setattr(backup, '_get_user_indices', AsyncMock(return_value=['novel_stories']))
    monkeypatch.setattr(backup, '_get_schema', AsyncMock(return_value={}))
    monkeypatch.setattr(backup, '_scroll_all', AsyncMock(return_value=[]))
    monkeypatch.setattr(plugin_manager, 'get_backup_plugin_inventory', AsyncMock(return_value=[]))
    response = await backup.export_backup(backup.ExportRequest(indices=['novel_stories'], include_files=False))
    exported = b''.join([chunk async for chunk in response.body_iterator])
    with zipfile.ZipFile(io.BytesIO(exported)) as archive:
        assert set(archive.namelist()) == {'backup.json', f'novel_images/{image_name}'}
    destination = tmp_path / 'restored'
    monkeypatch.setattr(backup, 'NOVEL_IMAGES_DIR', destination)
    await backup.import_backup(file=UploadFile(filename='backup.zip', file=io.BytesIO(exported)), indices=json.dumps(['novel_stories']), restore_files=False)
    assert (destination / image_name).read_bytes() == b'image-data'
    (destination / image_name).unlink()
    await backup.import_backup(file=UploadFile(filename='backup.zip', file=io.BytesIO(exported)), indices='[]', restore_files=False)
    assert not (destination / image_name).exists()


@pytest.mark.asyncio
async def test_image_archive_rejects_paths_and_ignores_deletion_tokens():
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, 'w') as archive:
        archive.writestr('backup.json', json.dumps({'vyact_backup': True, 'version': '3.0', 'indices': {}}))
        archive.writestr('novel_images/../escape.png', b'bad')
        archive.writestr('novel_images/' + 'a' * 32 + '.png.token', b'secret')
    parsed = await backup._read_backup(UploadFile(filename='backup.zip', file=io.BytesIO(buffer.getvalue())))
    assert parsed[-1] == {}
