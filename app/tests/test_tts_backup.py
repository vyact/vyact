import copy
import io
import json
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import UploadFile

from routers import backup, deps, setup
from services import plugin_manager, runtime_settings


@pytest.mark.asyncio
@pytest.mark.parametrize('language_voices', [None, {'en': 'bm_george', 'ja': 'jf_nezumi', 'zh': 'zf_xiaoni'}])
async def test_tts_settings_export_restore_round_trip(monkeypatch, language_voices):
    source_config = {'tts_kokoro_voice': 'bf_emma', 'tts_rate': 1.2, 'tts_volume': 0.7}
    if language_voices is not None:
        source_config['tts_kokoro_voices'] = language_voices
    document = {'_id': 'config', '_source': {'key': 'config', 'value': source_config}}
    es = AsyncMock()
    monkeypatch.setattr(backup, 'get_es', Mock(return_value=es))
    monkeypatch.setattr(backup, '_get_user_indices', AsyncMock(return_value=['system_settings']))
    monkeypatch.setattr(backup, '_get_schema', AsyncMock(return_value={}))
    monkeypatch.setattr(backup, '_scroll_all', AsyncMock(return_value=[document]))
    monkeypatch.setattr(plugin_manager, 'get_backup_plugin_inventory', AsyncMock(return_value=[]))
    monkeypatch.setattr(runtime_settings, 'apply_runtime_settings', Mock())

    response = await backup.export_backup(backup.ExportRequest(indices=['system_settings'], include_files=False))
    exported = b''.join([chunk async for chunk in response.body_iterator])
    exported_config = json.loads(exported)['indices']['system_settings']['docs'][0]['_source']['value']
    assert exported_config == source_config

    # Restore over different selections; an old backup must also clear a newer voice map.
    destination = {'model': 'local-model', 'tts_kokoro_voice': 'af_heart', 'tts_kokoro_voices': {'ja': 'jm_kumo'}}

    async def load_config():
        return copy.deepcopy(destination)

    async def write_bulk(*, operations, refresh):
        assert operations[0] == {'index': {'_index': 'system_settings', '_id': 'config'}}
        destination.clear()
        destination.update(operations[1]['value'])
        return {'items': [{'index': {'status': 200}}]}

    monkeypatch.setattr(deps, 'load_config_async', load_config)
    monkeypatch.setattr(setup, 'load_config_async', load_config)
    es.bulk.side_effect = write_bulk
    await backup.import_backup(
        file=UploadFile(filename='tts-backup.json', file=io.BytesIO(exported)),
        indices=json.dumps(['system_settings']), restore_files=False,
    )
    restored = await setup.get_tts_settings()
    assert restored['kokoroVoice'] == 'bf_emma'
    assert restored['kokoroVoices'] == (language_voices or {})
    assert restored['rate'] == 1.2
    assert restored['volume'] == 0.7
    assert destination['model'] == 'local-model'
