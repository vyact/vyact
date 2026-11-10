import asyncio
import copy
import unittest
from datetime import timedelta
from unittest.mock import AsyncMock, patch

from services.stock_analysis import financial_store as store
from services.stock_analysis import financial_collection as collection


def snapshot(period='2025-12-31', revenue=100):
    return {'currency': 'USD', 'statements': {
        'income': [{'period': period, 'values': {'revenue': revenue, 'netIncome': None}}],
        'balance': [], 'cashflow': [],
    }, 'checkedAt': store.utc_now().isoformat(), 'availability': 'available'}


class FinancialStoreTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.docs = {}
        self.patches = [patch.object(store, 'read_document', side_effect=self.read),
                        patch.object(store, 'write_document', side_effect=self.write),
                        patch.object(store, '_provider_lock', asyncio.Lock()),
                        patch.object(store, '_next_request', 0),
                        patch.object(store, 'REQUEST_INTERVAL_SECONDS', 0)]
        for item in self.patches:
            item.start()

    async def read(self, key):
        return copy.deepcopy(self.docs.get(key))

    async def write(self, key, data):
        self.docs[key] = copy.deepcopy(data)

    async def asyncTearDown(self):
        await store.stop_refreshes()
        for item in reversed(self.patches):
            item.stop()

    async def test_fresh_snapshot_never_calls_provider(self):
        self.docs['data:AAPL:yearly'] = snapshot()
        with patch.object(store, 'fetch_financials') as fetch:
            result = await store.get_financials('AAPL', 'yearly')
        self.assertFalse(result['refreshing'])
        fetch.assert_not_called()

    async def test_stale_reads_return_immediately_and_share_refresh(self):
        old = snapshot()
        old['checkedAt'] = (store.utc_now() - timedelta(days=2)).isoformat()
        self.docs['data:AAPL:yearly'] = old
        gate = asyncio.Event()
        async def refresh(*args):
            await gate.wait()
            return snapshot(revenue=120)
        with patch.object(store, '_refresh', side_effect=refresh) as fetch:
            first, second = await asyncio.gather(store.get_financials('AAPL', 'yearly'), store.get_financials('AAPL', 'yearly'))
            self.assertTrue(first['refreshing'])
            self.assertTrue(second['refreshing'])
            self.assertEqual(first['statements'], old['statements'])
            gate.set()
            await asyncio.gather(*store._refreshes.values())
            self.assertEqual(fetch.await_count, 1)

    async def test_initial_request_waits_and_persists(self):
        with patch.object(store, 'fetch_financials', return_value=snapshot()) as fetch:
            result = await store.get_financials('AAPL', 'yearly')
        self.assertFalse(result['refreshing'])
        self.assertIn('data:AAPL:yearly', self.docs)
        fetch.assert_called_once()

    async def test_merge_retains_old_period_and_valid_cells(self):
        old = snapshot('2020-12-31')
        old['statements']['income'].append({'period': '2025-12-31', 'values': {'revenue': 200, 'netIncome': 30}})
        self.docs['data:AAPL:yearly'] = old
        with patch.object(store, 'fetch_financials', return_value=snapshot(revenue=250)):
            result = await store._refresh('AAPL', 'yearly')
        rows = result['statements']['income']
        self.assertEqual([row['period'] for row in rows], ['2025-12-31', '2020-12-31'])
        self.assertEqual(rows[0]['values'], {'revenue': 250, 'netIncome': 30})

    async def test_empty_response_does_not_erase_previous_success(self):
        old = snapshot()
        self.docs['data:AAPL:yearly'] = old
        empty = {'currency': 'USD', 'statements': {key: [] for key in store.STATEMENT_METRICS}}
        with patch.object(store, 'fetch_financials', return_value=empty):
            with self.assertRaises(ValueError):
                await store._refresh('AAPL', 'yearly')
        self.assertEqual(self.docs['data:AAPL:yearly']['statements'], old['statements'])
        self.assertTrue(self.docs['data:AAPL:yearly']['refreshFailed'])

    async def test_currency_change_does_not_mix_history(self):
        self.docs['data:AAPL:yearly'] = snapshot()
        fresh = {**snapshot(), 'currency': 'KRW'}
        with patch.object(store, 'fetch_financials', return_value=fresh):
            with self.assertRaises(ValueError):
                await store._refresh('AAPL', 'yearly')
        self.assertEqual(self.docs['data:AAPL:yearly']['currency'], 'USD')

    async def test_failed_initial_request_respects_retry_cooldown(self):
        with patch.object(store, 'fetch_financials', side_effect=RuntimeError('offline')) as fetch:
            for _ in range(2):
                with self.assertRaises((RuntimeError, ValueError)):
                    await store.get_financials('AAPL', 'yearly')
        self.assertEqual(fetch.call_count, 1)

    async def test_empty_initial_result_is_cached_as_empty(self):
        empty = {'currency': None, 'statements': {key: [] for key in store.STATEMENT_METRICS}}
        with patch.object(store, 'fetch_financials', return_value=empty):
            result = await store.get_financials('AAPL', 'quarterly')
        self.assertEqual(result['availability'], 'empty')
        self.assertTrue(store.is_fresh(result))


class FinancialCollectionTests(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        self.docs = {}
        self.patches = [patch.object(collection, 'read_document', side_effect=self.read),
                        patch.object(collection, 'write_document', side_effect=self.write),
                        patch.object(collection, '_market_locks', {market: asyncio.Lock() for market in collection.MARKETS}),
                        patch.object(collection, '_jobs', {})]
        for item in self.patches:
            item.start()

    async def read(self, key):
        return copy.deepcopy(self.docs.get(key))

    async def write(self, key, data):
        self.docs[key] = copy.deepcopy(data)

    async def asyncTearDown(self):
        tasks = list(collection._jobs.values())
        for task in tasks:
            task.cancel()
        await asyncio.gather(*tasks, return_exceptions=True)
        for item in reversed(self.patches):
            item.stop()

    async def test_resume_skips_completed_symbols_and_counts_failures(self):
        self.docs['job:US'] = {'status': 'running', 'symbols': ['AAPL', 'MSFT', 'NVDA'], 'total': 3,
                               'processed': 1, 'failed': 0, 'empty': 0}
        with patch.object(collection, 'get_financials', new_callable=AsyncMock, side_effect=[snapshot(), snapshot(), RuntimeError('offline')]) as fetch:
            await collection.start_collection('US', resume=True)
            await collection._jobs['US']
        self.assertEqual([call.args[0] for call in fetch.call_args_list], ['MSFT', 'MSFT', 'NVDA'])
        job = self.docs['job:US']
        self.assertEqual((job['processed'], job['failed'], job['status']), (3, 1, 'completed'))
        self.assertEqual(job['failedSymbols'], ['NVDA'])

    async def test_full_collection_uses_entire_directory_and_deduplicates(self):
        custom = [{'symbol': f'TICKER{index}'} for index in range(150)] + [{'symbol': 'TICKER0'}, {'symbol': '^GSPC'}]
        with patch.object(collection, 'custom_data', new_callable=AsyncMock, return_value=custom), patch.object(collection, 'get_financials', new_callable=AsyncMock, return_value=snapshot()) as fetch:
            await collection.start_collection('US')
            await collection._jobs['US']
        self.assertEqual(self.docs['job:US']['total'], 150)
        self.assertEqual(fetch.await_count, 300)

    async def test_failure_retry_only_targets_failed_symbols(self):
        self.docs['job:US'] = {'status': 'completed', 'failedSymbols': ['MSFT'], 'lastFullStartedAt': '2026-01-01T00:00:00+00:00'}
        with patch.object(collection, 'get_financials', new_callable=AsyncMock, return_value=snapshot()) as fetch:
            await collection.start_collection('US', failed_only=True)
            await collection._jobs['US']
        self.assertEqual(fetch.await_count, 2)
        self.assertEqual(self.docs['job:US']['symbols'], ['MSFT'])
        self.assertEqual(self.docs['job:US']['lastFullStartedAt'], '2026-01-01T00:00:00+00:00')

    async def test_pause_is_persisted_and_status_hides_internal_queue(self):
        self.docs['job:US'] = {'status': 'running', 'symbols': ['AAPL'], 'failedSymbols': [], 'processed': 0, 'total': 1}
        await collection.stop_collection('US')
        status = await collection.collection_status('US')
        self.assertEqual(status['job']['status'], 'paused')
        self.assertNotIn('symbols', status['job'])

    async def test_weekly_schedule_resumes_running_and_skips_recent_or_paused(self):
        self.docs['job:US'] = {'status': 'running'}
        self.docs['settings:KR'] = {'autoUpdate': True}
        self.docs['job:KR'] = {'status': 'completed', 'lastFullStartedAt': store.utc_now().isoformat()}
        self.docs['settings:JP'] = {'autoUpdate': True}
        self.docs['job:JP'] = {'status': 'paused'}
        with patch.object(collection, 'start_collection', new_callable=AsyncMock) as start:
            await collection.run_scheduled_collections()
        start.assert_awaited_once_with('US', resume=True)

    async def test_weekly_schedule_runs_overdue_market(self):
        self.docs['settings:KR'] = {'autoUpdate': True}
        self.docs['job:KR'] = {'status': 'completed', 'lastFullStartedAt': (store.utc_now() - timedelta(days=8)).isoformat()}
        with patch.object(collection, 'start_collection', new_callable=AsyncMock) as start:
            await collection.run_scheduled_collections()
        start.assert_awaited_once_with('KR')
