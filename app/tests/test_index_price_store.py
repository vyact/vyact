import asyncio
import unittest
from datetime import datetime, timezone
from unittest.mock import AsyncMock, Mock, patch

from services.stock_analysis import index_price_store as store


def bar(day):
    return dict(day=day, open=100, high=110, low=95, close=105, volume=1000)


class IndexStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        store._sync_tasks.clear()
        self.es = Mock()
        self.es.bulk = AsyncMock(return_value={'errors': False})
        self.es.index = AsyncMock()
        self.es.indices.refresh = AsyncMock()

    async def test_bootstrap_and_incremental_upsert(self):
        rows = [bar(f'2026-11-{day:02d}') for day in range(1, 7)]
        with patch.object(store, 'fetch_prices', return_value=rows) as fetch:
            await store._sync('^GSPC', self.es, [], {})
            self.assertEqual(fetch.call_args.kwargs, {'start': None})
            self.assertEqual(self.es.bulk.call_args.kwargs['operations'][0]['index']['_id'], '^GSPC:2026-11-01')
            self.assertTrue(self.es.index.call_args.kwargs['document']['initialized'])
            await store._sync('^GSPC', self.es, rows, {'initialized': True})
            self.assertEqual(fetch.call_args.kwargs, {'start': '2026-11-02'})

    async def test_failed_bulk_never_marks_bootstrap_complete(self):
        self.es.bulk.return_value = {'errors': True}
        with patch.object(store, 'fetch_prices', return_value=[bar('2026-11-06')]):
            with self.assertLogs(store.logger, level='ERROR'), self.assertRaises(RuntimeError):
                await store._sync('^GSPC', self.es, [], {})
        self.es.index.assert_not_awaited()

    async def test_partial_bootstrap_retries_entire_history(self):
        with patch.object(store, 'fetch_prices', return_value=[bar('2026-11-06')]) as fetch:
            await store._sync('^GSPC', self.es, [bar('2026-11-05')], {})
        self.assertIsNone(fetch.call_args.kwargs['start'])

    async def test_stale_response_waits_for_shared_sync_and_returns_latest_day(self):
        gate = asyncio.Event()
        async def blocked_sync(*args):
            await gate.wait()
        with patch.object(store, 'get_es', return_value=self.es), \
             patch.object(store, 'ensure_market_index_prices_index', new=AsyncMock()), \
             patch.object(store, '_read_rows', new=AsyncMock(side_effect=[
                 [bar('2026-11-06')], [bar('2026-11-06')],
                 [bar('2026-11-06'), bar('2026-11-09')],
                 [bar('2026-11-06'), bar('2026-11-09')],
             ])), \
             patch.object(store, '_read_state', new=AsyncMock(return_value={})), \
             patch.object(store, '_sync', side_effect=blocked_sync) as sync:
            first = asyncio.create_task(store.get_index_prices('^GSPC'))
            second = asyncio.create_task(store.get_index_prices('^GSPC'))
            await asyncio.sleep(0)
            await asyncio.sleep(0)
            self.assertFalse(first.done())
            self.assertFalse(second.done())
            self.assertEqual(sync.call_count, 1)
            gate.set()
            responses = await asyncio.gather(first, second)
            self.assertTrue(all(rows[-1]['day'] == '2026-11-09' for rows in responses))

    async def test_failed_refresh_preserves_existing_history(self):
        rows = [bar('2026-11-06')]
        with patch.object(store, 'get_es', return_value=self.es), \
             patch.object(store, 'ensure_market_index_prices_index', new=AsyncMock()), \
             patch.object(store, '_read_rows', new=AsyncMock(return_value=rows)), \
             patch.object(store, '_read_state', new=AsyncMock(return_value={})), \
             patch.object(store, '_sync', new=AsyncMock(side_effect=ValueError('unavailable'))):
            self.assertEqual(await store.get_index_prices('^IXIC'), rows)

    async def test_pagination_reads_more_than_es_result_window(self):
        hits = [{'_source': bar(f'2026-11-0{day}'), 'sort': [day]} for day in (1, 2, 3)]
        self.es.search = AsyncMock(side_effect=[{'hits': {'hits': hits[:2]}}, {'hits': {'hits': hits[2:]}}])
        with patch.object(store, 'PAGE_SIZE', 2):
            rows = await store._read_rows(self.es, '^GSPC')
        self.assertEqual(len(rows), 3)
        self.assertEqual(self.es.search.call_args.kwargs['search_after'], [2])

    async def test_stocks_cannot_enter_store(self):
        with self.assertRaises(ValueError):
            await store.get_index_prices('MSFT')

    def test_weekend_is_skipped_only_after_friday_close_sync(self):
        now = datetime(2026, 11, 7, 12, tzinfo=timezone.utc)
        self.assertFalse(store._needs_sync({'initialized': True, 'synced_at': '2026-11-06T21:01:00+00:00'}, now))
        self.assertTrue(store._needs_sync({'initialized': True, 'synced_at': '2026-11-06T20:00:00+00:00'}, now))

    def test_friday_close_tracks_daylight_saving_time(self):
        cases = [
            # Summer: 16:00 New York is 20:00 UTC.
            ('2026-07-11T12:00:00+00:00', '2026-07-10T19:59:00+00:00', '2026-07-10T20:01:00+00:00'),
            # Winter: 16:00 New York is 21:00 UTC.
            ('2026-11-07T12:00:00+00:00', '2026-11-06T20:59:00+00:00', '2026-11-06T21:01:00+00:00'),
            # DST starts on Sunday; the preceding Friday is still standard time.
            ('2026-03-08T12:00:00+00:00', '2026-03-06T20:59:00+00:00', '2026-03-06T21:01:00+00:00'),
            # DST ends on Sunday; the preceding Friday is still daylight time.
            ('2026-11-01T12:00:00+00:00', '2026-10-30T19:59:00+00:00', '2026-10-30T20:01:00+00:00'),
        ]
        for current, before, after in cases:
            with self.subTest(current=current):
                now = datetime.fromisoformat(current)
                self.assertTrue(store._needs_sync({'initialized': True, 'synced_at': before}, now))
                self.assertFalse(store._needs_sync({'initialized': True, 'synced_at': after}, now))

    def test_korean_weekend_uses_seoul_friday_close(self):
        now = datetime(2026, 11, 7, 1, tzinfo=timezone.utc)
        self.assertTrue(store._needs_sync({'initialized': True, 'synced_at': '2026-11-06T06:29:00+00:00'}, now, '^KS11'))
        self.assertFalse(store._needs_sync({'initialized': True, 'synced_at': '2026-11-06T06:31:00+00:00'}, now, '^KS11'))
