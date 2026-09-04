import copy
import json
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

from services.llm.providers import openai_stream, gemini_stream, claude_stream


class Response:
    def __init__(self, payload):
        self.payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self.payload

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        pass

    async def aiter_lines(self):
        yield 'data: ' + json.dumps(self.payload)


class Client:
    def __init__(self, provider):
        self.provider = provider
        self.calls = []

    def response(self, body):
        self.calls.append(copy.deepcopy(body))
        if len(self.calls) == 1:
            names = ['hidden__delete_file', 'allowed__read_file']
            if self.provider == 'openai':
                return {'choices': [{'delta': {'tool_calls': [
                    {'index': i, 'id': str(i), 'type': 'function',
                     'function': {'name': name, 'arguments': '{}'}}
                    for i, name in enumerate(names)
                ]}, 'finish_reason': 'tool_calls'}]}
            if self.provider == 'gemini':
                return {'candidates': [{'content': {'parts': [
                    {'functionCall': {'name': name, 'args': {}}} for name in names
                ]}}]}
            return {'content': [
                {'type': 'tool_use', 'id': str(i), 'name': name, 'input': {}}
                for i, name in enumerate(names)
            ]}
        return {}

    async def post(self, url, **kwargs):
        return Response(self.response(kwargs['json']))

    def stream(self, method, url, **kwargs):
        return Response(self.response(kwargs['json']))


class ToolAllowlistTests(unittest.IsolatedAsyncioTestCase):
    async def test_unoffered_tool_never_reaches_approval_or_execution(self):
        offered = [{'type': 'function', 'function': {
            'name': 'allowed__read_file', 'description': 'Read',
            'parameters': {'type': 'object', 'properties': {}},
        }}]
        for provider, streamer in [('openai', openai_stream), ('gemini', gemini_stream), ('claude', claude_stream)]:
            with self.subTest(provider=provider), ExitStack() as stack:
                stack.enter_context(patch('services.llm.providers.get_provider_config', AsyncMock(return_value={
                    'type': provider, 'model': 'test', 'base_url': 'https://example.test/v1',
                })))
                stack.enter_context(patch('services.llm.providers._get_unified_tools', AsyncMock(return_value=(offered, ['allowed__read_file']))))
                stack.enter_context(patch('services.llm.providers.build_tool_directive', AsyncMock(return_value='')))
                stack.enter_context(patch('services.llm.providers.get_tool_language', AsyncMock(return_value='en')))
                approve = stack.enter_context(patch('services.llm.providers.await_tool_approval', AsyncMock(return_value=True)))
                execute = stack.enter_context(patch('services.mcp_client.mcp_manager.call_tool', AsyncMock(return_value='read result')))
                client = Client(provider)
                _ = [piece async for piece in streamer(client, 'test', 'key', 'system', 'question', [], [], [], 30)]
                approve.assert_awaited_once()
                self.assertEqual(approve.call_args.args[0], 'allowed__read_file')
                execute.assert_awaited_once_with('allowed__read_file', {})
                self.assertIn('Tool not offered in this request', json.dumps(client.calls[1:]))
