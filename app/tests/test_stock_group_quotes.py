import unittest
from unittest.mock import patch

from services.stock_analysis import sector_map


class StockGroupQuotesTests(unittest.TestCase):
    def setUp(self):
        sector_map._load_stock_quotes.cache_clear()

    def tearDown(self):
        sector_map._load_stock_quotes.cache_clear()

    def test_maps_provider_symbols_and_preserves_raw_market_caps(self):
        with patch.object(sector_map, 'yahoo_symbol', side_effect=lambda symbol: f'{symbol}.KS'), \
                patch.object(sector_map, '_us_quotes', return_value={'005930.KS': ('2026-11-06', 188700, -6.35, 1103000000000000)}) as fetch:
            result = sector_map.get_stock_quotes(['005930', '005930', '000660'])
            self.assertEqual(result, [{'symbol': '005930', 'date': '2026-11-06', 'price': 188700,
                                       'change': -6.35, 'marketCap': 1103000000000000}])
            self.assertEqual(fetch.call_args.args[0], ['000660.KS', '005930.KS'])

    def test_skips_unknown_listings_and_caches_identical_symbol_sets(self):
        def provider(symbol):
            if symbol == 'UNKNOWN':
                raise ValueError('unknown')
            return symbol

        with patch.object(sector_map, 'yahoo_symbol', side_effect=provider), \
                patch.object(sector_map, '_us_quotes', return_value={}) as fetch:
            self.assertEqual(sector_map.get_stock_quotes(['AAPL', 'UNKNOWN']), [])
            self.assertEqual(sector_map.get_stock_quotes(['UNKNOWN', 'AAPL']), [])
            fetch.assert_called_once_with(['AAPL'])
