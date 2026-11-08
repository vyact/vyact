import unittest
from unittest.mock import AsyncMock, patch

import httpx
from fastapi import FastAPI, HTTPException
from pydantic import ValidationError

from routers import stock_analysis as router
from services.stock_analysis import api_settings as api


class MarketApiSettingsTests(unittest.IsolatedAsyncioTestCase):
    def test_templates_encode_url_values_and_preserve_json_types(self):
        tokens = {'symbol': '^GSPC', 'market': 'US', 'language': 'en', 'period': 'max', 'interval': '1d'}
        self.assertEqual(api.render_template('http://localhost/prices/{symbol}?period={period}', tokens, url=True),
                         'http://localhost/prices/%5EGSPC?period=max')
        self.assertEqual(api.render_template({'symbol': '{symbol}', 'limit': 10, 'items': ['{market}']}, tokens),
                         {'symbol': '^GSPC', 'limit': 10, 'items': ['US']})

    def test_rejects_non_http_urls_and_header_injection(self):
        for url in ('file:///etc/passwd', 'https://user:pass@example.com/prices'):
            with self.assertRaises(ValidationError):
                api.ApiEndpoint(url=url)
        for field, value in [('apiKey', 'key\r\nHost: other'), ('headerName', 'Host'), ('keyPrefix', 'Bearer\n')]:
            with self.assertRaises(ValidationError):
                api.MarketApiSettings(**{field: value})

    def test_public_settings_never_return_key(self):
        public = api.public_settings(api.MarketApiSettings(apiKey='secret'))
        self.assertNotIn('apiKey', public)
        self.assertNotIn('clearApiKey', public)
        self.assertTrue(public['hasApiKey'])

    async def test_unconfigured_endpoint_uses_builtin_source(self):
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=api.MarketApiSettings())), patch.object(api.httpx, 'AsyncClient') as client:
            self.assertIsNone(await api.custom_data('KR', 'prices', symbol='005930.KS'))
            client.assert_not_called()

    async def test_post_request_and_response_validation(self):
        settings = api.MarketApiSettings(apiKey='secret', endpoints={'prices': api.ApiEndpoint(
            url='https://example.com/{market}/prices', method='POST', body={'symbol': '{symbol}', 'period': '{period}'})})
        rows = [{'day': '2026-11-06', 'open': 100, 'high': 105, 'low': 99, 'close': 103, 'volume': None}]
        request = httpx.Request('POST', 'https://example.com/KR/prices')
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, json=rows, request=request)
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=settings)), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            self.assertEqual(await api.custom_data('KR', 'prices', symbol='005930.KS'), rows)
            client.request.assert_awaited_once_with('POST', 'https://example.com/KR/prices',
                headers={'Authorization': 'Bearer secret'}, json={'symbol': '005930', 'period': '10y', 'interval': '1d'})
            for invalid in ({'data': rows}, rows + rows, [{**rows[0], 'close': -1}], [{**rows[0], 'day': 'invalid'}]):
                client.request.return_value = httpx.Response(200, json=invalid, request=request)
                with self.assertRaises(HTTPException) as raised:
                    await api.custom_data('KR', 'prices', symbol='005930.KS')
                self.assertEqual(raised.exception.detail, 'custom_stock_api_failed')

    async def test_save_keeps_replaces_and_clears_existing_key(self):
        for provided, clear, expected in [(None, False, 'old'), ('new', False, 'new'), (None, True, '')]:
            es = AsyncMock()
            with patch.object(api, 'load_api_settings', AsyncMock(return_value=api.MarketApiSettings(apiKey='old'))), patch.object(api, 'get_es', return_value=es):
                public = await api.save_api_settings('US', api.MarketApiSettings(apiKey=provided, clearApiKey=clear))
                self.assertEqual(es.index.call_args.kwargs['document']['value']['apiKey'], expected)
                self.assertEqual(public['hasApiKey'], bool(expected))
                es.close.assert_awaited_once()

    def test_market_for_comparison_and_index_symbols(self):
        for symbol in ('KS11', 'KQ11', '005930', '0001A0', '005930.KS', '123456.KQ', '^KS11', '^KQ11'):
            self.assertEqual(api.symbol_market(symbol), 'KR')
        for symbol in ('GSPC', 'IXIC', 'RUT', 'AAPL', '^GSPC', '^IXIC', '^RUT'):
            self.assertEqual(api.symbol_market(symbol), 'US')


class MarketApiRouteTests(unittest.IsolatedAsyncioTestCase):
    async def test_each_data_route_dispatches_to_its_market_endpoint(self):
        application = FastAPI()
        application.include_router(router.router)
        paths = [('/symbols/KR?language=ko', ('KR', 'symbols'), {'language': 'ko'}),
                 ('/sector-map/US', ('US', 'sectorMap'), {'language': 'en'}),
                 ('/market-indices?market=KR', ('KR', 'marketIndices'), {}),
                 ('/prices/005930.KS', ('KR', 'prices'), {'symbol': '005930.KS'}),
                 ('/prices/%5EGSPC', ('US', 'prices'), {'symbol': '^GSPC'}),
                 ('/sparkline/AAPL', ('US', 'sparkline'), {'symbol': 'AAPL'})]
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=application), base_url='http://test') as client:
            for path, args, kwargs in paths:
                with patch.object(router, 'custom_data', AsyncMock(return_value=[])) as custom:
                    response = await client.get('/stock-analysis' + path)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.json(), [])
                    custom.assert_awaited_once_with(*args, **kwargs)


class AdditionalHeaderTests(unittest.IsolatedAsyncioTestCase):
    def test_header_values_are_not_returned(self):
        settings = api.MarketApiSettings(headers=[api.ApiHeader(name='X-Gateway', value='secret')])
        self.assertEqual(api.public_settings(settings)['headers'], [{'name': 'X-Gateway', 'hasValue': True}])

    def test_invalid_and_duplicate_headers_are_rejected(self):
        for headers in ([{'name': 'X-Key', 'value': 'a\nb'}], [{'name': 'Host', 'value': 'other'}],
                        [{'name': 'X-Key', 'value': 'one'}, {'name': 'x-key', 'value': 'two'}]):
            with self.assertRaises(ValidationError):
                api.MarketApiSettings(headers=headers)

    async def test_save_preserves_omitted_values_and_removes_deleted_headers(self):
        es = AsyncMock()
        previous = api.MarketApiSettings(headers=[api.ApiHeader(name='X-Key', value='old'), api.ApiHeader(name='X-Removed', value='remove')])
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=previous)), patch.object(api, 'get_es', return_value=es):
            await api.save_api_settings('KR', api.MarketApiSettings(headers=[api.ApiHeader(name='x-key')]))
            self.assertEqual(es.index.call_args.kwargs['document']['value']['headers'], [{'name': 'x-key', 'value': 'old'}])

    async def test_requests_include_extra_headers_and_api_key_wins(self):
        settings = api.MarketApiSettings(apiKey='key', headers=[api.ApiHeader(name='X-Gateway', value='gateway'), api.ApiHeader(name='authorization', value='ignored')],
            endpoints={'sparkline': api.ApiEndpoint(url='https://example.com/{symbol}')})
        client = AsyncMock()
        client.request.return_value = httpx.Response(200, json=[1, 2], request=httpx.Request('GET', 'https://example.com/AAPL'))
        with patch.object(api, 'load_api_settings', AsyncMock(return_value=settings)), patch.object(api.httpx, 'AsyncClient') as factory:
            factory.return_value.__aenter__.return_value = client
            self.assertEqual(await api.custom_data('US', 'sparkline', symbol='AAPL'), [1, 2])
            self.assertEqual(client.request.call_args.kwargs['headers'], {'X-Gateway': 'gateway', 'Authorization': 'Bearer key'})
