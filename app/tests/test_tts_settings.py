from unittest.mock import AsyncMock

import pytest

from routers import setup


@pytest.mark.asyncio
async def test_legacy_voice_is_retained_when_loading(monkeypatch):
    monkeypatch.setattr(setup, 'load_config_async', AsyncMock(return_value={'tts_kokoro_voice': 'jf_nezumi'}))
    settings = await setup.get_tts_settings()
    assert settings['kokoroVoice'] == 'jf_nezumi'
    assert settings['kokoroVoices'] == {}


@pytest.mark.asyncio
async def test_language_voices_round_trip_and_survive_legacy_save(monkeypatch):
    config = {'tts_kokoro_voice': 'bf_emma'}
    monkeypatch.setattr(setup, 'load_config_async', AsyncMock(return_value=config))
    save = AsyncMock()
    monkeypatch.setattr(setup, 'save_config_async', save)
    settings = await setup.set_tts_settings({
        'kokoroVoice': 'bf_emma', 'kokoroVoices': {'en': 'am_echo', 'ja': 'jf_nezumi'},
    })
    save.assert_awaited_once_with(config)
    assert (await setup.get_tts_settings())['kokoroVoices'] == settings['kokoroVoices']
    await setup.set_tts_settings({'kokoroVoice': 'af_heart', 'rate': 1.2})
    assert config['tts_kokoro_voices'] == {'en': 'am_echo', 'ja': 'jf_nezumi'}
