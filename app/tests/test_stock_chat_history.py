import unittest
from unittest.mock import AsyncMock, patch

from services.stock_analysis.chat_history import append_stock_conversation, get_stock_conversation, list_stock_conversations


class StockChatHistoryTests(unittest.IsolatedAsyncioTestCase):
    async def test_list_filters_by_symbol_and_omits_messages(self):
        es = AsyncMock()
        es.indices.exists.return_value = True
        es.search.return_value = {'hits': {'hits': [{'_id': 'chat', '_source': {'symbol': '005930', 'title': 'Question'}}]}}
        with patch('services.stock_analysis.chat_history.get_es', return_value=es):
            result = await list_stock_conversations('005930.KS')
        self.assertEqual(result[0]['id'], 'chat')
        self.assertEqual(es.search.call_args.kwargs['query'], {'term': {'symbol': '005930'}})
        self.assertEqual(es.search.call_args.kwargs['source_excludes'], ['messages'])

    async def test_other_symbols_conversations_are_not_returned(self):
        es = AsyncMock()
        es.indices.exists.return_value = True
        es.get.return_value = {'_id': 'chat', '_source': {'symbol': '000660', 'messages': []}}
        with patch('services.stock_analysis.chat_history.get_es', return_value=es):
            self.assertIsNone(await get_stock_conversation('005930', 'chat'))

    async def test_appends_turn_without_replacing_existing_messages(self):
        es = AsyncMock()
        es.indices.exists.return_value = True
        with patch('services.stock_analysis.chat_history.get_es', return_value=es):
            await append_stock_conversation('005930.KS', 'chat', 'Question', 'Answer')
        request = es.update.call_args.kwargs
        self.assertEqual(request['upsert']['symbol'], '005930')
        self.assertEqual(request['script']['params']['messages'], [
            {'role': 'user', 'content': 'Question'}, {'role': 'assistant', 'content': 'Answer'},
        ])
        self.assertIn('addAll', request['script']['source'])
