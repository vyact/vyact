import unittest
from datetime import date
from unittest.mock import AsyncMock, patch

import httpx
import pandas as pd
from fastapi import Response

from routers import stock_analysis as router
from services.stock_analysis import api_settings, prices, symbols


class StockSymbolTests(unittest.TestCase):
    def test_canonical_codes_preserve_exchange_metadata(self):
        self.assertEqual(symbols.normalize_stock({'symbol': '005930.KS', 'name': 'Samsung'}),
                         {'symbol': '005930', 'name': 'Samsung', 'exchange': 'KOSPI'})
        self.assertEqual(symbols.normalize_stock({'symbol': '0001A0.KQ', 'name': 'Stock'}),
                         {'symbol': '0001A0', 'name': 'Stock', 'exchange': 'KOSDAQ'})
        for symbol in ('BRK.B', 'AAPL', 'KS11', 'GSPC', '005930'):
            self.assertEqual(symbols.public_symbol(symbol), symbol)

    def test_index_codes_are_canonical_in_public_responses_and_keep_legacy_memos(self):
        self.assertEqual(symbols.public_symbol('^KS11'), 'KS11')
        self.assertEqual(symbols.public_symbol('^GSPC'), 'GSPC')
        self.assertTrue(symbols.is_market_index('KS11'))
        self.assertEqual(symbols.symbol_market('KS11'), 'KR')
        self.assertEqual(symbols.normalize_market_indices([{'symbol': '^KS11', 'price': 100}]), [{'symbol': 'KS11', 'price': 100}])
        self.assertEqual(symbols.memo_symbol_aliases('KS11'), ['KS11', '^KS11'])

    @patch.object(symbols, 'korea_symbols', return_value={'005930.KS': 'Samsung', '0001A0.KQ': 'Stock'})
    def test_yahoo_conversion_uses_actual_exchange(self, directory):
        self.assertEqual(symbols.yahoo_symbol('005930'), '005930.KS')
        self.assertEqual(symbols.yahoo_symbol('0001A0'), '0001A0.KQ')
        self.assertEqual(symbols.yahoo_symbol('AAPL'), 'AAPL')
        self.assertEqual(symbols.yahoo_symbol('^KS11'), '^KS11')
        self.assertEqual(symbols.yahoo_symbol('KS11'), '^KS11')
        self.assertEqual(symbols.yahoo_symbol('KQ11'), '^KQ11')
        self.assertEqual(symbols.yahoo_symbol('GSPC'), '^GSPC')
        for source, expected in {'SOUL-U': 'SOUL-UN', 'AAC-W': 'AAC-WT',
                                 'SOUL-R': 'SOUL-RI', 'NE-A': 'NE-WTA',
                                 '7203.T': '7203.T', '0700.HK': '0700.HK',
                                 '2330.TW': '2330.TW', '600519.SS': '600519.SS'}.items():
            self.assertEqual(symbols.yahoo_symbol(source), expected)
        with self.assertRaises(ValueError):
            symbols.yahoo_symbol('999999')

    @patch.object(symbols, 'korea_symbols', return_value={'005930.KS': 'Samsung', '0001A0.KQ': 'Stock'})
    @patch.object(prices.yf, 'Ticker')
    def test_history_and_sparklines_add_suffix_only_at_yahoo_boundary(self, ticker, directory):
        ticker.return_value.history.return_value = pd.DataFrame()
        prices.fetch_prices('005930')
        ticker.assert_called_with('005930.KS')
        ticker.return_value.history.return_value = pd.DataFrame({'Close': [100, 101]})
        self.assertEqual(prices._fetch_sparkline('0001A0', -1), (100.0, 101.0))
        ticker.assert_called_with('0001A0.KQ')


class StockSymbolRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_builtin_directory_returns_codes_and_exchange(self):
        with patch.object(router, 'custom_data', AsyncMock(return_value=None)), patch.object(router, 'get_symbols', return_value={'005930.KS': 'Samsung', '0001A0.KQ': 'Stock'}), patch.object(router, 'korea_preferred_symbols', return_value={'0001A0.KQ'}):
            self.assertEqual(await router.list_symbols('KR', 'ko'), [
                {'symbol': '005930', 'name': 'Samsung', 'preferred': False, 'exchange': 'KOSPI'},
                {'symbol': '0001A0', 'name': 'Stock', 'preferred': True, 'exchange': 'KOSDAQ'},
            ])

    async def test_custom_symbol_responses_accept_codes_and_legacy_suffixes(self):
        settings = api_settings.MarketApiSettings(endpoints={'symbols': api_settings.ApiEndpoint(url='https://example.com/symbols')})
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, request=httpx.Request('GET', 'https://example.com/symbols'), json=[
            {'symbol': '005930', 'name': 'Samsung', 'exchange': 'KOSPI'}, {'symbol': '0001A0.KQ', 'name': 'Stock'},
        ])
        with patch.object(api_settings, 'load_api_settings', AsyncMock(return_value=settings)), patch.object(api_settings.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            result = await api_settings.custom_data('KR', 'symbols')
            self.assertEqual([(stock['symbol'], stock['exchange']) for stock in result], [('005930', 'KOSPI'), ('0001A0', 'KOSDAQ')])

    async def test_legacy_memos_remain_readable(self):
        es = AsyncMock()
        memo = {'symbol': '005930.KS', 'day': '2026-11-06', 'title': 'Legacy', 'content': 'memo'}
        es.search.return_value = {'hits': {'hits': [{'_source': memo}]}}
        with patch.object(router, 'get_es', return_value=es):
            result = await router.list_stock_memos('005930', Response())
            self.assertEqual(result, [{**memo, 'symbol': '005930'}])
            self.assertEqual(es.search.call_args.kwargs['query'], {'terms': {'symbol': ['005930', '005930.KS', '005930.KQ']}})

    async def test_updating_legacy_memo_keeps_its_existing_document_id(self):
        es = AsyncMock()
        es.exists.side_effect = [False, True]
        with patch.object(router, 'get_es', return_value=es), patch.object(router, 'ensure_stock_chart_memos_index', AsyncMock()):
            saved = await router.save_stock_memo('005930', date(2026, 11, 6), router.StockMemoDraft(title='Updated', content='memo'))
            self.assertEqual(saved['symbol'], '005930')
            self.assertEqual(es.index.call_args.kwargs['id'], '005930.KS:2026-11-06')

    async def test_memo_delete_covers_both_legacy_exchanges(self):
        es = AsyncMock()
        with patch.object(router, 'get_es', return_value=es):
            await router.delete_stock_memo('005930', date(2026, 11, 6))
            self.assertEqual([call.kwargs['id'] for call in es.delete.call_args_list],
                             ['005930:2026-11-06', '005930.KS:2026-11-06', '005930.KQ:2026-11-06'])
