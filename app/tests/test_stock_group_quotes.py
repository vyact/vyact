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
            fetch.assert_called_once_with(['AAPL'], details={})

    def test_premarket_group_quotes_keep_close_and_mark_missing_quotes_neutral(self):
        def fetch(symbols, *, details):
            details['AAPL'] = {'regularMarketPrice': 100, 'regularMarketTime': 900,
                               'preMarketPrice': 103, 'preMarketTime': 1500}
            return {'AAPL': ('2026-11-10', 100, -2, 300), 'MSFT': ('2026-11-10', 200, -4, 100)}

        with patch.object(sector_map, '_us_quotes', side_effect=fetch), \
                patch.object(sector_map, 'time', return_value=1600), \
                patch.object(sector_map, 'us_premarket_window', return_value=(1000, 2000)):
            quotes = sector_map.get_stock_quotes(['AAPL', 'MSFT'])
        self.assertAlmostEqual(quotes[0]['change'], 3)
        self.assertEqual(quotes[0]['price'], 103)
        self.assertEqual(quotes[0]['regularPrice'], 100)
        self.assertEqual(quotes[0]['regularChange'], -2)
        self.assertEqual(quotes[0]['session'], 'premarket')
        self.assertIsNone(quotes[1]['price'])
        self.assertIsNone(quotes[1]['change'])
        self.assertEqual(quotes[1]['marketCap'], 100)
