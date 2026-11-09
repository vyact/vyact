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


class FuturesSelectionTests(unittest.TestCase):
    def setUp(self):
        market_indices._load_indices.cache_clear()

    def tearDown(self):
        market_indices._load_indices.cache_clear()

    def load(self, cash_open, futures_open, futures_age=60, missing=False):
        now = 1794259000

        def session(calendar, timestamp):
            active = cash_open if calendar == market_indices.CASH_CALENDAR else futures_open
            return (now - 3600, now + 3600) if active else None

        def quote(symbol):
            future = symbol in market_indices.US_INDEX_FUTURES.values()
            return {'symbol': symbol, 'price': None if future and missing else 100,
                    'quoteTime': now - (futures_age if future else 60), 'closes': [99, 100]}

        with patch.object(market_indices, 'time', return_value=now), \
                patch.object(market_indices, 'active_session', side_effect=session), \
                patch.object(market_indices, '_safe_fetch_index', side_effect=quote):
            return market_indices._load_indices(1, 'US')

    def test_regular_session_keeps_cash(self):
        self.assertEqual([q['symbol'] for q in self.load(True, True)], ['^GSPC', '^IXIC', '^RUT'])

    def test_closed_futures_keeps_cash_close(self):
        self.assertEqual([q['symbol'] for q in self.load(False, False)], ['^GSPC', '^IXIC', '^RUT'])

    def test_open_futures_switches_symbols_and_keeps_card_slots(self):
        quotes = self.load(False, True)
        self.assertEqual([q['symbol'] for q in quotes], ['ES=F', 'NQ=F', 'RTY=F'])
        self.assertEqual([q['indexSymbol'] for q in quotes], ['GSPC', 'IXIC', 'RUT'])

    def test_stale_or_failed_futures_keeps_cash_close(self):
        for kwargs in [{'futures_age': 1900}, {'futures_age': 7200}, {'missing': True}]:
            market_indices._load_indices.cache_clear()
            self.assertEqual([q['symbol'] for q in self.load(False, True, **kwargs)], ['^GSPC', '^IXIC', '^RUT'])


class JapaneseFuturesSelectionTests(unittest.TestCase):
    def setUp(self):
        market_indices._load_indices.cache_clear()

    def tearDown(self):
        market_indices._load_indices.cache_clear()

    def load(self, instant, fresh=True):
        now = datetime.fromisoformat(instant).timestamp()

        def quote(symbol):
            return {'symbol': symbol, 'price': 59000, 'quoteTime': now - (60 if fresh else 7200), 'closes': [58000, 59000]}

        with patch.object(market_indices, 'time', return_value=now), patch.object(market_indices, '_safe_fetch_index', side_effect=quote):
            return market_indices._load_indices(1, 'JP')[0]

    def test_japanese_regular_session_and_lunch_keep_cash(self):
        for instant in ['2026-11-09T10:00:00+09:00', '2026-11-09T11:45:00+09:00', '2026-11-09T12:30:00+09:00']:
            market_indices._load_indices.cache_clear()
            self.assertEqual(self.load(instant)['symbol'], '^N225')

    def test_japanese_overnight_uses_yen_cme_futures(self):
        quote = self.load('2026-11-09T20:00:00+09:00')
        self.assertEqual(quote['symbol'], 'NIY=F')
        self.assertEqual(quote['indexSymbol'], 'N225')
        self.assertEqual(quote['nextRegularOpen'], datetime.fromisoformat('2026-11-10T09:00:00+09:00').timestamp())

    def test_closed_or_stale_cme_quotes_keep_japanese_cash(self):
        self.assertEqual(self.load('2026-11-09T20:00:00+09:00', fresh=False)['symbol'], '^N225')
        market_indices._load_indices.cache_clear()
        self.assertEqual(self.load('2026-11-10T07:30:00+09:00')['symbol'], '^N225')
