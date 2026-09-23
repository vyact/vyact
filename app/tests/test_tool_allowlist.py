import copy
import json
import unittest
from contextlib import ExitStack
from unittest.mock import AsyncMock, patch

from services.llm.providers import _budget_memory_list_result, openai_stream, gemini_stream, claude_stream
from services.user_memory_tools import memory_list_token_budget, memory_write_stage


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
    async def test_memory_list_budget_reserves_answer_tokens(self):
        config = {'context_size': 10000, 'max_output_tokens': 2048}
        with patch('services.llm.providers.token_counter.count_cloud_message_tokens', return_value=5000):
            await _budget_memory_list_result('user_memory_list', [{'role': 'user', 'content': 'hello'}], config)
        self.assertEqual(memory_list_token_budget.get(), 1672)

        local = {'context_size': 32768, 'is_local': True}
        with patch('services.llm.providers.token_counter.count_local_message_tokens', AsyncMock(return_value=20000)):
            await _budget_memory_list_result('user_memory_list', [{'role': 'user', 'content': 'hello'}],
                                             local, output_limit=8192)
        self.assertEqual(memory_list_token_budget.get(), 3296)

    async def test_turning_memory_off_after_list_sends_no_empty_tool_schema(self):
        offered = [{'type': 'function', 'function': {
            'name': 'user_memory_list', 'description': 'List',
            'parameters': {'type': 'object', 'properties': {}},
        }}]

        class ListThenAnswerClient(Client):
            def response(self, body):
                self.calls.append(copy.deepcopy(body))
                if len(self.calls) > 1:
                    return {}
                if self.provider == 'openai':
                    return {'choices': [{'delta': {'tool_calls': [{
                        'index': 0, 'id': 'list', 'type': 'function',
                        'function': {'name': 'user_memory_list', 'arguments': '{}'},
                    }]}, 'finish_reason': 'tool_calls'}]}
                if self.provider == 'gemini':
                    return {'candidates': [{'content': {'parts': [
                        {'functionCall': {'name': 'user_memory_list', 'args': {}}},
                    ]}}]}
                return {'content': [{'type': 'tool_use', 'id': 'list',
                                     'name': 'user_memory_list', 'input': {}}]}

        async def execute(_name, _args):
            memory_write_stage.set(True)
            return '{}'

        for provider, streamer in [('openai', openai_stream), ('gemini', gemini_stream), ('claude', claude_stream)]:
            with self.subTest(provider=provider), ExitStack() as stack:
                stack.enter_context(patch('services.llm.providers.get_provider_config', AsyncMock(return_value={
                    'type': provider, 'model': 'test', 'base_url': 'https://example.test/v1',
                })))
                stack.enter_context(patch('services.llm.providers._get_unified_tools', AsyncMock(
                    side_effect=[(offered, ['user_memory_list']), ([], [])],
                )))
                stack.enter_context(patch('services.llm.providers.build_tool_directive', AsyncMock(return_value='')))
                stack.enter_context(patch('services.llm.providers.get_tool_language', AsyncMock(return_value='en')))
                stack.enter_context(patch('services.llm.providers.await_tool_approval', AsyncMock(return_value=True)))
                stack.enter_context(patch('services.mcp_client.mcp_manager.call_tool', side_effect=execute))
                client = ListThenAnswerClient(provider)
                _ = [piece async for piece in streamer(client, 'test', 'key', 'system', 'question', [], [], [], 30)]
                self.assertNotIn('tools', client.calls[-1])
            memory_write_stage.set(False)

    async def test_memory_list_switches_next_round_to_memory_writes_only(self):
        initial = [
            {'type': 'function', 'function': {'name': name, 'description': name,
             'parameters': {'type': 'object', 'properties': {}}}}
            for name in ('user_memory_list', 'unrelated_tool')
        ]
        writes = [
            {'type': 'function', 'function': {'name': name, 'description': name,
             'parameters': {'type': 'object', 'properties': {}}}}
            for name in ('user_memory_save', 'user_memory_update')
        ]

        class MemoryClient(Client):
            def response(self, body):
                self.calls.append(copy.deepcopy(body))
                names = ('user_memory_list', 'user_memory_save')
                if len(self.calls) > len(names):
                    return {}
                round_names = ('user_memory_list', 'unrelated_tool') if len(self.calls) == 1 else (
                    'user_memory_save', 'user_memory_update',
                )
                if self.provider == 'openai':
                    return {'choices': [{'delta': {'tool_calls': [{
                        'index': index, 'id': f'{len(self.calls)}-{index}', 'type': 'function',
                        'function': {'name': name, 'arguments': '{}'},
                    } for index, name in enumerate(round_names)]}, 'finish_reason': 'tool_calls'}]}
                if self.provider == 'gemini':
                    return {'candidates': [{'content': {'parts': [
                        {'functionCall': {'name': name, 'args': {}}}
                        for name in round_names]}}]}
                return {'content': [{'type': 'tool_use', 'id': f'{len(self.calls)}-{index}',
                                     'name': name, 'input': {}}
                                    for index, name in enumerate(round_names)]}

        async def execute(name, _args):
            if name == 'user_memory_list':
                memory_write_stage.set(True)
            return '{}'

        for provider, streamer in [('openai', openai_stream), ('gemini', gemini_stream), ('claude', claude_stream)]:
            with self.subTest(provider=provider), ExitStack() as stack:
                stack.enter_context(patch('services.llm.providers.get_provider_config', AsyncMock(return_value={
                    'type': provider, 'model': 'test', 'base_url': 'https://example.test/v1',
                })))
                unified = stack.enter_context(patch('services.llm.providers._get_unified_tools', AsyncMock(
                    side_effect=[(initial, ['user_memory_list', 'unrelated_tool']),
                                 (writes, ['user_memory_save', 'user_memory_update']),
                                 (writes, ['user_memory_save', 'user_memory_update'])],
                )))
                stack.enter_context(patch('services.llm.providers.build_tool_directive', AsyncMock(return_value='')))
                stack.enter_context(patch('services.llm.providers.get_tool_language', AsyncMock(return_value='en')))
                stack.enter_context(patch('services.llm.providers.await_tool_approval', AsyncMock(return_value=True)))
                executed = stack.enter_context(patch('services.mcp_client.mcp_manager.call_tool', side_effect=execute))
                client = MemoryClient(provider)
                _ = [piece async for piece in streamer(client, 'test', 'key', 'system', 'question', [], [], [], 30)]
                self.assertGreaterEqual(unified.await_count, 2)
                self.assertEqual([call.args[0] for call in executed.await_args_list],
                                 ['user_memory_list', 'user_memory_save', 'user_memory_update'])
                second_tools = client.calls[1]['tools']
                self.assertNotIn('unrelated_tool', json.dumps(second_tools))
                self.assertIn('user_memory_save', json.dumps(second_tools))
                self.assertIn('Tool not offered in this request', json.dumps(client.calls[1:]))
                if provider != 'openai':
                    self.assertNotIn('tools', client.calls[-1])
            memory_write_stage.set(False)

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
                metadata = {'annotations': {'readOnlyHint': True}, 'annotations_trusted': True}
                lookup = stack.enter_context(patch('services.mcp_client.mcp_manager.get_tool_approval_metadata', return_value=metadata))
                approve = stack.enter_context(patch('services.llm.providers.await_tool_approval', AsyncMock(return_value=True)))
                execute = stack.enter_context(patch('services.mcp_client.mcp_manager.call_tool', AsyncMock(return_value='read result')))
                client = Client(provider)
                _ = [piece async for piece in streamer(client, 'test', 'key', 'system', 'question', [], [], [], 30)]
                lookup.assert_called_once_with('allowed__read_file')
                self.assertEqual(approve.call_args.kwargs, metadata)
                approve.assert_awaited_once()
                self.assertEqual(approve.call_args.args[0], 'allowed__read_file')
                execute.assert_awaited_once_with('allowed__read_file', {})
                self.assertIn('Tool not offered in this request', json.dumps(client.calls[1:]))
