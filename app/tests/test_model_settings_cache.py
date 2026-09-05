from unittest.mock import AsyncMock, Mock

import pytest

from services import model_settings_cache as cache
from services import hardware_info


@pytest.mark.asyncio
async def test_persistent_settings_metadata_reuse_and_file_invalidation(tmp_path, monkeypatch):
    model = tmp_path / 'model.gguf'
    model.write_bytes(b'first')
    stored = {}

    async def read(*args):
        return stored.get('document')

    async def save(*args):
        stored['document'] = args[-1]

    loader = Mock(return_value={'info': {'path': str(model), 'limits': {}}, 'reasoning': {}, 'modalities': []})
    monkeypatch.setattr(cache, 'get_cached_model_metadata', read)
    monkeypatch.setattr(cache, 'save_cached_model_metadata', save)
    monkeypatch.setattr(cache, '_read_settings_metadata', loader)
    first = await cache.read_model_settings_metadata('owner/model.gguf', 'gguf', model)
    second = await cache.read_model_settings_metadata('owner/model.gguf', 'gguf', model)
    assert first == second
    assert loader.call_count == 1
    model.write_bytes(b'replacement')
    await cache.read_model_settings_metadata('owner/model.gguf', 'gguf', model)
    assert loader.call_count == 2
    (tmp_path / 'mmproj.gguf').write_bytes(b'projector')
    await cache.read_model_settings_metadata('owner/model.gguf', 'gguf', model)
    assert loader.call_count == 3


def test_settings_hardware_reuses_snapshot_without_sharing_mutable_data(monkeypatch):
    hardware_info._settings_hardware_snapshot.cache_clear()
    probe = Mock(return_value={'gpus': [{'name': 'GPU'}]})
    monkeypatch.setattr(hardware_info, 'get_local_hardware_info', probe)
    try:
        hardware_info.get_settings_hardware_info()['gpus'].clear()
        assert hardware_info.get_settings_hardware_info()['gpus'] == [{'name': 'GPU'}]
        probe.assert_called_once()
    finally:
        hardware_info._settings_hardware_snapshot.cache_clear()
