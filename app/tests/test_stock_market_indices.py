import unittest
from datetime import datetime, timezone
from unittest.mock import patch

from services.stock_analysis import market_indices


class MarketIndexTests(unittest.TestCase):
    @patch.object(market_indices, 'YfData')
    def test_index_changes_use_previous_close_and_chart_uses_same_session(self, data):
        timestamp = int(datetime(2026, 11, 6, 21, tzinfo=timezone.utc).timestamp())
        data.return_value.get_raw_json.return_value = {'chart': {'result': [{
            'meta': {'regularMarketPrice': 110, 'chartPreviousClose': 100, 'regularMarketTime': timestamp},
            'timestamp': [timestamp - 86400, timestamp - 300, timestamp],
            'indicators': {'quote': [{'close': [95, 108, 110]}]},
        }]}}
        quote = market_indices._fetch_index('^GSPC')
        self.assertEqual(quote['date'], '2026-11-06')
        self.assertEqual(quote['change'], 10)
        self.assertAlmostEqual(quote['changePercent'], 10)
        self.assertEqual(quote['closes'], [108, 110])

    @patch.object(market_indices, '_fetch_index', side_effect=ValueError('missing data'))
    def test_unavailable_index_returns_placeholder(self, fetch):
        with self.assertLogs(market_indices.logger, level='WARNING'):
            quote = market_indices._safe_fetch_index('^RUT')
        self.assertIsNone(quote['price'])
        self.assertEqual(quote['closes'], [])
