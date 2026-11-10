import copy
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from services.stock_analysis import market_group_cache as cache
from services.stock_analysis import industry_classification as classification

HOLDINGS = ('Fund Holdings as of,"Nov 09, 2026"\n'
            'Ticker,Name,Sector,Asset Class,Market Value\n'
            'AAPL,Apple,Information Technology,Equity,999\n'
            'SNDK,Sandisk,Information Technology,Equity,111\n')


class DailyMarketGroupTests(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.path = Path(temporary.name) / 'groups.json'
        self.day = '2026-11-10'
        patches = [patch.object(cache, 'GROUP_CACHE_FILE', self.path), patch.object(cache, '_cached', None),
                   patch.object(cache, '_disk_loaded', False), patch.object(cache, '_next_retry', 0),
                   patch.object(cache, 'MINIMUM_GROUP_SYMBOLS', 2),
                   patch.object(cache, '_today', side_effect=lambda: self.day),
                   patch.object(cache, 'fetch_us_industries', return_value={'AAPL': 'Hardware', 'SNDK': 'Storage'})]
        self.classification = None
        for item in patches:
            result = item.start()
            self.addCleanup(item.stop)
            self.classification = result
        self.client = Mock()
        self.client.get.return_value.text = HOLDINGS

    def test_same_day_reads_fetch_membership_only_once_and_persist_it(self):
        first = cache.get_us_market_groups(self.client)
        second = cache.get_us_market_groups(self.client)
        self.assertEqual(first, second)
        self.client.get.assert_called_once_with(cache.IVV_HOLDINGS_URL)
        self.classification.assert_called_once()
        self.assertEqual(json.loads(self.path.read_text()), first)
        self.assertEqual(first['groups']['Information Technology'][1]['industry'], 'Storage')

    def test_restart_reuses_saved_membership_without_requesting_sources(self):
        expected = cache.get_us_market_groups(self.client)
        cache._cached = None
        cache._disk_loaded = False
        self.client.reset_mock()
        self.classification.reset_mock()
        self.assertEqual(cache.get_us_market_groups(self.client), expected)
        self.client.get.assert_not_called()
        self.classification.assert_not_called()

    def test_next_market_date_refreshes_once_and_keeps_holdings_date_separate(self):
        cache.get_us_market_groups(self.client)
        self.day = '2026-11-11'
        result = cache.get_us_market_groups(self.client)
        cache.get_us_market_groups(self.client)
        self.assertEqual(self.client.get.call_count, 2)
        self.assertEqual(result['checkedDate'], '2026-11-11')
        self.assertEqual(result['date'], '2026-11-09')

    def test_failed_classification_keeps_entire_previous_snapshot_and_backs_off(self):
        previous = copy.deepcopy(cache.get_us_market_groups(self.client))
        saved = self.path.read_text()
        self.day = '2026-11-11'
        self.classification.side_effect = RuntimeError('offline')
        self.assertEqual(cache.get_us_market_groups(self.client), previous)
        self.assertEqual(cache.get_us_market_groups(self.client), previous)
        self.assertEqual(self.client.get.call_count, 2)
        self.assertEqual(self.path.read_text(), saved)

    def test_initial_failure_does_not_repeat_on_every_quote_refresh(self):
        self.client.get.side_effect = RuntimeError('offline')
        for _ in range(2):
            with self.assertRaises((RuntimeError, ValueError)):
                cache.get_us_market_groups(self.client)
        self.client.get.assert_called_once()
        self.assertFalse(self.path.exists())

    def test_corrupt_saved_snapshot_is_replaced(self):
        self.path.write_text('{invalid')
        result = cache.get_us_market_groups(self.client)
        self.assertEqual(result['checkedDate'], self.day)
        self.assertTrue(cache._valid(json.loads(self.path.read_text())))


CLASSIFICATION_CSV = 'Symbol,Security,GICS Sub-Industry\nBRK.B,Berkshire,Multi-Sector Holdings\nSNDK,Sandisk,"Technology Hardware, Storage & Peripherals"\n'


class IndustryClassificationTests(unittest.TestCase):
    def test_parses_quoted_industries_and_normalizes_share_class_symbols(self):
        result = classification.parse_industries(CLASSIFICATION_CSV)
        self.assertEqual(result['BRK-B'], 'Multi-Sector Holdings')
        self.assertEqual(result['SNDK'], 'Technology Hardware, Storage & Peripherals')
        with self.assertRaises(ValueError):
            classification.parse_industries('Symbol,Sector\nSNDK,Technology\n')

    def test_fetch_requires_a_complete_classification(self):
        client = Mock()
        client.get.return_value.text = CLASSIFICATION_CSV
        with patch.object(classification, 'MINIMUM_CLASSIFIED_SYMBOLS', 2):
            result = classification.fetch_us_industries(client)
        self.assertEqual(result['BRK-B'], 'Multi-Sector Holdings')
        client.get.assert_called_once_with(classification.CLASSIFICATION_URL)
        client.get.return_value.text = 'Symbol,GICS Sub-Industry\n'
        with self.assertRaises(ValueError):
            classification.fetch_us_industries(client)


class DailyLayoutWeightsTests(unittest.TestCase):
    def test_weights_stay_fixed_until_next_day_and_survive_restart(self):
        membership = cache.parse_us_holdings(HOLDINGS, {})
        with tempfile.TemporaryDirectory() as directory, patch.object(cache, 'GROUP_CACHE_FILE', Path(directory) / 'groups.json'), patch.object(cache, '_today', return_value='2026-11-10') as today:
            first = cache.freeze_us_layout_weights(membership, {'AAPL': 1000, 'SNDK': 200})
            self.assertEqual(first, {'AAPL': 1000, 'SNDK': 200})
            self.assertEqual(cache.freeze_us_layout_weights(membership, {'AAPL': 500, 'SNDK': 900}), first)
            restored = json.loads(cache.GROUP_CACHE_FILE.read_text())
            self.assertEqual(cache.freeze_us_layout_weights(restored, {}), first)
            today.return_value = '2026-11-11'
            self.assertEqual(cache.freeze_us_layout_weights(restored, {'AAPL': 1100}), {'AAPL': 1100, 'SNDK': 200})

    def test_empty_initial_response_does_not_freeze_an_empty_day(self):
        membership = cache.parse_us_holdings(HOLDINGS, {})
        with patch.object(cache, '_save'):
            self.assertEqual(cache.freeze_us_layout_weights(membership, {}), {})
            self.assertNotIn('layoutDate', membership)
            self.assertEqual(cache.freeze_us_layout_weights(membership, {'AAPL': 1000}), {'AAPL': 1000})
