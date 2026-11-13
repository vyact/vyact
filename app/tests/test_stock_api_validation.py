import json
import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI

from routers import stock_analysis as router
from services.stock_analysis import api_settings as api


class StockApiValidationTests(unittest.IsolatedAsyncioTestCase):
    async def test_delete_saved_key_updates_only_the_key(self):
        es = AsyncMock()
        settings = api.MarketApiSettings(endpoints={'quotes': api.ApiEndpoint(url='https://example.com/quotes')})
        with patch.object(api, 'get_es', return_value=es), patch.object(api, 'load_api_settings', AsyncMock(return_value=settings)):
            result = await api.delete_api_key('KR')
        es.update.assert_awaited_once_with(index=api.SETTINGS_INDEX, id='stock_api:KR', doc={'value': {'apiKey': ''}}, refresh='wait_for')
        es.close.assert_awaited_once()
        self.assertFalse(result['hasApiKey'])
        self.assertNotIn('apiKey', result)
        self.assertEqual(result['endpoints']['quotes']['url'], 'https://example.com/quotes')

    async def test_quote_request_and_market_cap_response_contract(self):
        payload = [{'symbol': '005930', 'date': '2026-11-06', 'price': 188700, 'change': -6.35, 'marketCap': 1103000000000000}]
        for method in ('GET', 'POST'):
            settings = api.MarketApiSettings(endpoints={'quotes': api.ApiEndpoint(url='https://example.com/quotes', method=method)})
            client = AsyncMock()
            client.request.return_value = httpx.Response(200, json=payload, request=httpx.Request(method, 'https://example.com/quotes'))
            with patch.object(api.httpx, 'AsyncClient') as factory:
                factory.return_value.__aenter__.return_value = client
                result = await api.execute_api_request(settings, 'KR', 'quotes', symbols=['005930', '000660'])
                self.assertEqual(result.data, payload)
                if method == 'POST':
                    self.assertEqual(client.request.call_args.kwargs['json'], {'symbols': ['005930', '000660'], 'market': 'KR'})
                else:
                    self.assertIn('symbols=005930%2C000660', client.request.call_args.args[1])

    async def test_quotes_reject_invalid_market_caps_and_unrequested_symbols(self):
        settings = api.MarketApiSettings(endpoints={'quotes': api.ApiEndpoint(url='https://example.com/quotes')})
        quote = {'symbol': '005930', 'date': '2026-11-06', 'price': 188700, 'change': -6.35, 'marketCap': 1}
        for payload in [[{**quote, 'marketCap': 0}], [{**quote, 'symbol': '000660'}], [quote, quote]]:
            client = AsyncMock()
            client.request.return_value = httpx.Response(200, json=payload, request=httpx.Request('GET', 'https://example.com/quotes'))
            with patch.object(api.httpx, 'AsyncClient') as factory:
                factory.return_value.__aenter__.return_value = client
                with self.assertRaises(api.ApiValidationFailure):
                    await api.execute_api_request(settings, 'KR', 'quotes', symbols=['005930'])

    async def test_batch_sparkline_request_and_response_contract(self):
        payload = {'005930': [100, 101], '000660': []}
        for method in ('GET', 'POST'):
            settings = api.MarketApiSettings(endpoints={'sparkline': api.ApiEndpoint(url='https://example.com/sparkline', method=method)})
            client = AsyncMock()
            client.request.return_value = httpx.Response(200, json=payload, request=httpx.Request(method, 'https://example.com/sparkline'))
            with patch.object(api.httpx, 'AsyncClient') as factory:
                factory.return_value.__aenter__.return_value = client
                result = await api.execute_api_request(settings, 'KR', 'sparkline', symbols=['005930', '000660'])
                self.assertEqual(result.data, payload)
                if method == 'GET':
                    self.assertIn('symbols=005930%2C000660', client.request.call_args.args[1])
                else:
                    self.assertEqual(client.request.call_args.kwargs['json'], {'symbols': ['005930', '000660'], 'period': '3mo', 'interval': '1d'})
                client.request.return_value = httpx.Response(200, json={'005930': [100]}, request=httpx.Request(method, 'https://example.com'))
                with self.assertRaises(api.ApiValidationFailure):
                    await api.execute_api_request(settings, 'KR', 'sparkline', symbols=['005930', '000660'])

    async def test_batch_route_groups_markets_and_deduplicates(self):
        async def custom(market, kind, **kwargs):
            return {symbol: [100] for symbol in kwargs['symbols']}
        with patch.object(router, 'custom_data', AsyncMock(side_effect=custom)) as fetch:
            result = await router.sparklines(router.SparklineBatchRequest(symbols=['005930', '005930', 'AAPL']))
            self.assertEqual(result, {'005930': [100], 'AAPL': [100]})
            self.assertEqual(fetch.await_count, 2)
            self.assertEqual(fetch.call_args_list[0].kwargs['symbols'], ['005930'])

    async def check_response(self, payload=None, *, status=200, text=None, kind='prices', failure=None):
        settings = api.MarketApiSettings(endpoints={kind: api.ApiEndpoint(url='https://example.com/{symbol}')})
        client = AsyncMock()
        request = httpx.Request('GET', 'https://example.com/005930')
        client.request.return_value = httpx.Response(status, request=request, **({'text': text} if text is not None else {'json': payload}))
        if failure is not None:
            client.request.side_effect = failure
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=api.MarketApiSettings())), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            return await api.validate_api_settings('KR', kind, api.ApiValidationRequest(settings=settings))

    async def test_unsaved_post_settings_use_saved_secrets_without_saving_or_returning_them(self):
        previous = api.MarketApiSettings(apiKey='saved-key', headers=[api.ApiHeader(name='X-Gateway', value='saved-gateway')])
        draft = api.MarketApiSettings(headerName='X-Api-Key', keyPrefix='', headers=[api.ApiHeader(name='X-Gateway')],
            endpoints={'sparkline': api.ApiEndpoint(url='https://example.com/draft/{market}', method='POST',
                body={'symbol': '{symbol}', 'period': '{period}', 'interval': '{interval}'})})
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, json=[100, 101], request=httpx.Request('POST', 'https://example.com/draft/KR'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=previous)), patch.object(api, 'save_api_settings', AsyncMock()) as save, patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            result = await api.validate_api_settings('KR', 'sparkline', api.ApiValidationRequest(settings=draft, language='ko'))
            self.assertEqual(result, {'ok': True, 'code': 'valid', 'status': 200, 'count': 2, 'fields': []})
            client.request.assert_awaited_once_with('POST', 'https://example.com/draft/KR',
                headers={'X-Gateway': 'saved-gateway', 'X-Api-Key': 'saved-key'}, json={'symbol': '005930', 'period': '3mo', 'interval': '1d'})
            save.assert_not_awaited()
            self.assertNotIn('saved-', json.dumps(result))
            self.assertIsNone(draft.apiKey)
            self.assertIsNone(draft.headers[0].value)

    async def test_validation_calls_a_bare_get_url_with_sample_parameters(self):
        draft = api.MarketApiSettings(endpoints={'sparkline': api.ApiEndpoint(url='https://example.com/sparkline')})
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, json=[100], request=httpx.Request('GET', 'https://example.com/sparkline'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=api.MarketApiSettings())), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            result = await api.validate_api_settings('KR', 'sparkline', api.ApiValidationRequest(settings=draft))
            self.assertTrue(result['ok'])
            client.request.assert_awaited_once_with('GET', 'https://example.com/sparkline?symbol=005930&period=3mo&interval=1d', headers={})

    async def test_user_entered_validation_parameters_are_forwarded_without_saving(self):
        draft = api.MarketApiSettings(endpoints={'prices': api.ApiEndpoint(url='https://example.com/prices')})
        client = AsyncMock()
        row = {'day': '2026-11-06', 'open': 100, 'high': 105, 'low': 98, 'close': 103, 'volume': 100}
        client.request.return_value = httpx.Response(200, json=[row], request=httpx.Request('GET', 'https://example.com/prices'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=api.MarketApiSettings())), patch.object(api, 'save_api_settings', AsyncMock()) as save, patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            result = await api.validate_api_settings('KR', 'prices', api.ApiValidationRequest(
                settings=draft, symbol='000660', period='5y', interval='1wk', language='ko'))
            self.assertTrue(result['ok'])
            client.request.assert_awaited_once_with('GET', 'https://example.com/prices?symbol=000660&period=5y&interval=1wk', headers={})
            save.assert_not_awaited()
            self.assertEqual(draft.endpoints['prices'].url, 'https://example.com/prices')
            self.assertEqual(draft.endpoints['prices'].body, {})

    async def test_http_errors_and_invalid_json_are_reported_without_provider_body(self):
        result = await self.check_response({'secret': 'do-not-return'}, status=401)
        self.assertEqual((result['ok'], result['code'], result['status']), (False, 'http_error', 401))
        self.assertNotIn('do-not-return', json.dumps(result))
        result = await self.check_response(text='<html>do-not-return</html>')
        self.assertEqual(result['code'], 'invalid_json')
        self.assertNotIn('do-not-return', json.dumps(result))

    async def test_required_fields_and_price_dates_are_checked(self):
        result = await self.check_response([{'day': '2026-11-06', 'token': 'do-not-return'}])
        self.assertEqual(result['code'], 'invalid_schema')
        self.assertIn('0.close', result['fields'])
        self.assertNotIn('do-not-return', json.dumps(result))
        row = {'day': '2026-11-06', 'open': 100, 'high': 105, 'low': 98, 'close': 103, 'volume': None}
        result = await self.check_response([row, row])
        self.assertEqual(result['code'], 'invalid_dates')
        result = await self.check_response([row, {**row, 'day': '2026-11-05'}])
        self.assertEqual(result['code'], 'invalid_dates')
        result = await self.check_response([row])
        self.assertEqual((result['ok'], result['count']), (True, 1))

    async def test_sparkline_values_and_duplicate_stock_codes_are_rejected(self):
        for payload in ([0, 100], [-1], [100] * 21):
            result = await self.check_response(payload, kind='sparkline')
            self.assertEqual(result['code'], 'invalid_schema')
        result = await self.check_response([{'symbol': '005930', 'name': 'One'}, {'symbol': '005930.KS', 'name': 'Two'}], kind='symbols')
        self.assertEqual(result['code'], 'invalid_schema')
        self.assertEqual(result['fields'], ['symbol'])

    async def test_optional_investors_are_preserved_and_missing_data_stays_optional(self):
        row = {'day': '2026-11-06', 'open': 100, 'high': 105, 'low': 98, 'close': 103, 'volume': None}
        investors = {'ind': {'buyVolume': 100, 'buyAmount': 10300, 'sellVolume': -40, 'sellAmount': -4080,
                             'netVolume': 60, 'netAmount': 6220, 'averagePrice': 103},
                     'for': {'netVolume': -60, 'netAmount': -6220, 'averagePrice': -104}}
        settings = api.MarketApiSettings(endpoints={'prices': api.ApiEndpoint(url='https://example.com/prices')})
        client = AsyncMock()
        # Use distinct dates; only investor fields differ in the payload contract.
        optional_fields = {'sharesOutstanding': 1000000, 'marketCap': 103000000, 'loanBalanceVolume': 0, 'loanBalanceAmount': 0}
        payload = [{**row, 'day': '2026-11-05', 'investors': investors, 'tradingValue': 123456789, 'changePercent': -6.35, **optional_fields}, row]
        client.request.return_value = httpx.Response(200, json=payload, request=httpx.Request('GET', 'https://example.com/prices'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=settings)), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            result = await api.custom_data('KR', 'prices', symbol='005930')
            self.assertEqual(result[0]['investors'], investors)
            self.assertEqual(result[0]['tradingValue'], 123456789)
            self.assertEqual(result[0]['changePercent'], -6.35)
            for key, value in optional_fields.items():
                self.assertEqual(result[0][key], value)
                self.assertIsNone(result[1].get(key))
            self.assertNotIn('investors', result[1])

    async def test_canonical_index_code_is_sent_with_full_history_period(self):
        settings = api.MarketApiSettings(endpoints={'prices': api.ApiEndpoint(url='https://example.com/prices')})
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, json=[], request=httpx.Request('GET', 'https://example.com/prices'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=settings)), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            await api.custom_data('KR', 'prices', symbol='KS11')
            client.request.assert_awaited_once_with('GET', 'https://example.com/prices?symbol=KS11&period=max&interval=1d', headers={})

    async def test_empty_success_is_distinct_from_a_failed_response(self):
        result = await self.check_response([], kind='sparkline')
        self.assertEqual((result['ok'], result['code'], result['count']), (True, 'empty', 0))
        result = await self.check_response([{'symbol': '^KS11', 'price': None, 'change': None, 'changePercent': None, 'date': None, 'closes': []}], kind='marketIndices')
        self.assertEqual(result['code'], 'empty')

    async def test_timeout_connection_errors_and_blank_urls_do_not_fall_back(self):
        for failure, expected in [(httpx.ReadTimeout('secret URL'), 'timeout'), (httpx.ConnectError('secret URL'), 'connection_error')]:
            result = await self.check_response(failure=failure)
            self.assertEqual(result['code'], expected)
            self.assertNotIn('secret URL', json.dumps(result))
        with patch.object(api, 'load_api_settings', AsyncMock()) as load:
            result = await api.validate_api_settings('KR', 'prices', api.ApiValidationRequest(settings=api.MarketApiSettings()))
            self.assertEqual(result['code'], 'url_required')
            load.assert_not_awaited()

    async def test_route_accepts_draft_settings_and_returns_no_store(self):
        application = FastAPI()
        application.include_router(router.router)
        previous = api.MarketApiSettings(apiKey='stored')
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
            with patch.object(api, 'load_api_settings', AsyncMock(return_value=previous)), patch.object(api, 'execute_api_request', AsyncMock(return_value=api.ApiResult([100], 200))) as execute:
                response = await client.post('/stock-analysis/api-settings/KR/validate/sparkline', json={
                    'settings': {'endpoints': {'sparkline': {'url': 'https://example.com/draft'}}}, 'symbol': '005930', 'language': 'ko'})
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.headers['Cache-Control'], 'no-store')
                self.assertTrue(response.json()['ok'])
                self.assertEqual(execute.call_args.args[0].apiKey, 'stored')


class AutomaticRequestParametersTests(unittest.TestCase):
    def setUp(self):
        self.tokens = {'symbol': '005930', 'market': 'KR', 'language': 'ko', 'period': '10y', 'interval': '1d'}

    def test_get_bare_url_injects_dynamic_parameters(self):
        url, payload = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices'), 'prices', self.tokens)
        self.assertEqual(url, 'https://example.com/prices?symbol=005930&period=10y&interval=1d')
        self.assertEqual(payload, {})
        url, _ = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices'), 'prices', {**self.tokens, 'symbol': '000660'})
        self.assertIn('symbol=000660', url)
        self.assertNotIn('005930', url)

    def test_post_bare_url_injects_body_and_preserves_extra_fields(self):
        url, payload = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices', method='POST', body={'feed': 'daily'}), 'prices', self.tokens)
        self.assertEqual(url, 'https://example.com/prices')
        self.assertEqual(payload, {'json': {'feed': 'daily', 'symbol': '005930', 'period': '10y', 'interval': '1d'}})

    def test_market_and_language_are_added_for_directory_requests(self):
        url, _ = api.build_api_request(api.ApiEndpoint(url='https://example.com/symbols'), 'symbols', self.tokens)
        self.assertEqual(url, 'https://example.com/symbols?market=KR&language=ko')
        _, payload = api.build_api_request(api.ApiEndpoint(url='https://example.com/symbols', method='POST'), 'symbols', self.tokens)
        self.assertEqual(payload, {'json': {'market': 'KR', 'language': 'ko'}})

    def test_literal_reserved_values_are_replaced_and_custom_queries_are_kept(self):
        url, _ = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices?symbol=OLD&period=1y&token=custom'), 'prices', self.tokens)
        self.assertEqual(url, 'https://example.com/prices?symbol=005930&period=10y&token=custom&interval=1d')
        _, payload = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices', method='POST', body={'symbol': 'OLD'}), 'prices', self.tokens)
        self.assertEqual(payload['json']['symbol'], '005930')

    def test_legacy_placeholder_aliases_and_paths_still_work_without_duplicate_fields(self):
        url, _ = api.build_api_request(api.ApiEndpoint(url='https://example.com/{symbol}?range={period}'), 'prices', self.tokens)
        self.assertEqual(url, 'https://example.com/005930?range=10y&interval=1d')
        _, payload = api.build_api_request(api.ApiEndpoint(url='https://example.com/prices', method='POST', body={'ticker': '{symbol}'}), 'prices', self.tokens)
        self.assertEqual(payload['json'], {'ticker': '005930', 'period': '10y', 'interval': '1d'})
