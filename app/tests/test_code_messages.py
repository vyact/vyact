import asyncio
import json
from string import Formatter
from unittest.mock import AsyncMock, patch

import pytest

from services.code_messages import MESSAGES, code_message, localized_code_tool
from services.code_tools import _create_file, _read_files, _delete_file, current_code_folders, current_code_question
from services.llm.tools import tool_result_failed


def test_catalog_keys_and_placeholders_match():
    formatter = Formatter()
    for translations in MESSAGES.values():
        assert translations.keys() == MESSAGES['en'].keys()
        for key, text in translations.items():
            fields = lambda value: {field for _, field, _, _ in formatter.parse(value) if field}
            assert fields(text) == fields(MESSAGES['en'][key])


@pytest.mark.asyncio
@pytest.mark.parametrize('language', list(MESSAGES))
async def test_code_tool_results_and_confirmation_keep_language(tmp_path, language):
    folder_token = current_code_folders.set({'demo': str(tmp_path)})
    question_token = current_code_question.set('')
    try:
        with patch('services.code_messages.get_tool_language', AsyncMock(return_value=language)) as load:
            result = await _create_file('demo', 'test.txt', 'original content')
            assert result == '✅ ' + MESSAGES[language]['created'].format(path='test.txt', count=1)
            load.reset_mock()
            result = await _read_files('demo', ['test.txt'])
            assert 'original content' in result
            assert load.await_count == 1
            result = await _create_file('demo', 'test.txt', 'replacement')
            assert tool_result_failed(result)
            assert json.loads(result)['error'] == MESSAGES[language]['exists'].format(value='test.txt')
            assert (tmp_path / 'test.txt').read_text() == 'original content'
            result = await _delete_file('demo', 'test.txt')
            assert result == MESSAGES[language]['confirm_delete'].format(value='test.txt')
            assert (tmp_path / 'test.txt').exists()
    finally:
        current_code_folders.reset(folder_token)
        current_code_question.reset(question_token)


@pytest.mark.asyncio
async def test_concurrent_tools_do_not_leak_language():
    @localized_code_tool
    async def result():
        await asyncio.sleep(0)
        return code_message('no_output')

    with patch('services.code_messages.get_tool_language', AsyncMock(side_effect=['ko', 'fr'])):
        assert await asyncio.gather(result(), result()) == ['(출력 없음)', '(Aucune sortie)']
    assert code_message('no_output') == '(No output)'
