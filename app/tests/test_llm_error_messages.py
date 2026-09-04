import httpx
import pytest

from services.llm.errors import http_err_msg
from services.llm.messages import MESSAGES


@pytest.mark.parametrize('language', list(MESSAGES))
@pytest.mark.parametrize('status,key', [(401, 'invalid_key'), (429, 'rate_limit'), (503, 'unavailable')])
def test_provider_status_errors_are_localized_even_without_json(language, status, key):
    request = httpx.Request('POST', 'https://example.invalid')
    response = httpx.Response(status, request=request, text='not JSON')
    error = httpx.HTTPStatusError('failed', request=request, response=response)
    assert http_err_msg(error, 'OpenAI', language) == MESSAGES[language][key].format(provider='OpenAI')
