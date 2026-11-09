import json
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from fastapi import FastAPI
import httpx
import pytest

from routers import stock_analysis as router
from services.stock_analysis import catalog, market_indices, regional_yahoo, sector_map
from services.stock_analysis.symbols import is_market_index, normalize_market_indices, symbol_market, yahoo_symbol


def test_japanese_symbols_stay_unambiguous_and_indices_use_tokyo():
    for symbol in ('7203.T', '130A.T', 'N225', '^N225'):
        assert symbol_market(symbol) == 'JP'
    assert yahoo_symbol('7203.T') == '7203.T'
    assert yahoo_symbol('N225') == '^N225'
    assert is_market_index('N225')
    assert normalize_market_indices([{'symbol': '^N225'}]) == [{'symbol': 'N225'}]
    assert str(market_indices.index_timezone('^N225')) == 'Asia/Tokyo'
    instant = datetime(2026, 11, 8, 23, tzinfo=timezone.utc)
    assert instant.astimezone(market_indices.index_timezone('^N225')).day == 9


def test_directory_uses_japanese_names_without_affecting_korean_provider_cache():
    regional_yahoo._directory.cache_clear()
    page = {'total': 2, 'quotes': [{'symbol': '7203.T', 'longName': 'トヨタ自動車'}, {'symbol': 'AAPL', 'longName': 'Apple'}]}
    with patch.object(regional_yahoo, '_screen', return_value=page) as screen:
        result = catalog.get_symbols('JP', 'ja')
    assert result == {'7203.T': 'トヨタ自動車'}
    screen.assert_called_once_with(language='ja', region='JP')
    regional_yahoo._directory.cache_clear()


def test_screener_queries_japan_and_localizes_names():
    response = Mock()
    response.json.return_value = {'finance': {'result': [{'quotes': []}]}}
    with patch.object(regional_yahoo, 'YfData') as factory:
        factory.return_value.post.return_value = response
        regional_yahoo._screen(language='ja', region='JP')
    kwargs = factory.return_value.post.call_args.kwargs
    assert json.loads(kwargs['data'])['query']['operands'] == ['region', 'jp']
    assert kwargs['params']['lang'] == 'ja-JP'


def test_japanese_sector_members_include_alphanumeric_codes_only_on_tokyo_exchange():
    with patch.object(regional_yahoo, '_screen', return_value={'total': 3, 'quotes': [
        {'symbol': '7203.T'}, {'symbol': '130A.T'}, {'symbol': '005930.KS'},
    ]}):
        assert regional_yahoo._sector_members('Industrials', 'JP') == ('Industrials', ['7203.T', '130A.T'])


def test_japanese_map_uses_market_caps_and_ignores_stale_quotes():
    with patch.object(sector_map, 'get_japan_sector_members', return_value={'Consumer Cyclical': ['7203.T', '7267.T']}), \
            patch.object(sector_map, 'japan_display_names', return_value={'7203.T': 'トヨタ自動車'}), \
            patch.object(sector_map, '_us_quotes', return_value={
                '7203.T': ('2026-11-09', 3491, 4.58, 41000000000000),
                '7267.T': ('2026-11-06', 1500, -1, 8000000000000),
            }):
        result = sector_map._regional_map('JP', 'ja')
    assert result['quoteDate'] == '2026-11-09'
    stock = result['sectors'][0]['stocks'][0]
    assert stock['symbol'] == '7203.T'
    assert stock['name'] == 'トヨタ自動車'
    assert stock['weight'] == 41000000000000
    assert len(result['sectors'][0]['stocks']) == 1


@pytest.mark.asyncio
async def test_japan_routes_accept_market_and_quoted_japanese_symbols():
    app = FastAPI()
    app.include_router(router.router, prefix="/api")
    with patch.object(router, 'custom_data', return_value=None), \
            patch.object(router, 'get_symbols', return_value={'7203.T': 'Toyota'}), \
            patch.object(router, 'fetch_prices', return_value=[]):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            directory = await client.get('/api/stock-analysis/symbols/JP')
            prices = await client.get('/api/stock-analysis/prices/7203.T')
    assert directory.status_code == 200
    assert directory.json()[0]['symbol'] == '7203.T'
    assert prices.status_code == 200


@pytest.mark.parametrize('language,expected', [('ja', 'トヨタ自動車'), ('ja-JP', 'トヨタ自動車'),
                                               ('ko', 'TOYOTA MOTOR CORP'), ('en', 'TOYOTA MOTOR CORP'), ('fr', 'TOYOTA MOTOR CORP')])
def test_japanese_names_follow_ui_language(language, expected):
    with patch.object(regional_yahoo, '_directory', return_value={
        '7203.T': {'longName': 'トヨタ自動車', 'shortName': 'TOYOTA MOTOR CORP'},
    }):
        assert regional_yahoo.japan_display_names(language)['7203.T'] == expected


@pytest.mark.parametrize('language,expected', [('ko', '삼성전자'), ('ko-KR', '삼성전자'),
                                               ('ja', 'SamsungElec'), ('en', 'SamsungElec'), ('fr', 'SamsungElec')])
def test_korean_names_follow_ui_language(language, expected):
    with patch.object(regional_yahoo, '_directory', return_value={
        '005930.KS': {'longName': '삼성전자', 'shortName': 'SamsungElec'},
    }):
        assert regional_yahoo.korea_display_names(language)['005930.KS'] == expected
        assert regional_yahoo.korea_symbols(0)['005930.KS'] == 'SamsungElec'


def test_names_fall_back_when_provider_fields_are_missing():
    assert regional_yahoo._names({'7203.T': {'longName': 'トヨタ自動車'}})['7203.T'] == 'トヨタ自動車'
    assert regional_yahoo._names({'7203.T': {}})['7203.T'] == '7203.T'
