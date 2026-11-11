"""Regression checks for Yahoo-only Taiwan, Hong Kong and mainland China support."""
from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
import httpx
from fastapi import FastAPI
from routers import stock_analysis as router

from services.stock_analysis import regional_yahoo, sector_map
from services.stock_analysis.catalog import get_symbols
from services.stock_analysis.market_indices import MARKET_INDEX_SYMBOLS, index_timezone
from services.stock_analysis.market_sessions import MARKET_CASH_CALENDARS, active_session
from services.stock_analysis.symbols import is_market_index, public_symbol, symbol_market, yahoo_symbol


@pytest.mark.parametrize('market,symbol,index', [
    ('TW', '2330.TW', '^TWII'), ('TW', '3293.TWO', '^TWII'),
    ('HK', '0700.HK', '^HSI'), ('CN', '600519.SS', '000001.SS'),
    ('CN', '300750.SZ', '399001.SZ'),
])
def test_symbols_and_indices_preserve_provider_codes(market, symbol, index):
    assert symbol_market(symbol) == market
    assert yahoo_symbol(symbol) == symbol
    assert not is_market_index(symbol)
    assert symbol_market(public_symbol(index)) == market
    assert is_market_index(public_symbol(index))
    assert yahoo_symbol(public_symbol(index)) == index
    assert index in MARKET_INDEX_SYMBOLS[market]
    assert str(index_timezone(index)) in ('Asia/Taipei', 'Asia/Hong_Kong', 'Asia/Shanghai')


@pytest.mark.parametrize('market,symbol,excluded', [
    ('TW', '2330.TW', '2002A.TW'), ('HK', '0700.HK', '0700.T'), ('CN', '600519.SS', '900901.SS'),
])
def test_directory_pagination_filters_other_securities(market, symbol, excluded):
    regional_yahoo._directory.cache_clear()
    pages = [{'total': 2, 'quotes': [{'symbol': symbol, 'shortName': 'Company'}]},
             {'quotes': [{'symbol': excluded, 'shortName': 'Excluded'}]}]
    with patch.object(regional_yahoo, 'DIRECTORY_PAGE_SIZE', 1), patch.object(regional_yahoo, '_screen', side_effect=pages):
        result = get_symbols(market)
    assert result == {symbol: 'Company'}
    regional_yahoo._directory.cache_clear()


@pytest.mark.parametrize('market,symbol', [('TW', '2330.TW'), ('HK', '0700.HK'), ('CN', '600519.SS')])
def test_regional_map_uses_market_cap_and_latest_quote(market, symbol):
    with patch.object(sector_map, 'regional_sector_members', return_value={'Technology': [symbol, 'STALE']}), \
            patch.object(sector_map, 'regional_display_names', return_value={symbol: 'Company'}), \
            patch.object(sector_map, '_us_quotes', return_value={symbol: ('2026-11-11', 100, 2, 500), 'STALE': ('2026-11-10', 90, 1, 300)}):
        snapshot = sector_map._regional_map(market)
    assert snapshot['quoteDate'] == '2026-11-11'
    assert snapshot['sectors'][0]['stocks'] == [{'symbol': symbol, 'name': 'Company', 'weight': 500, 'price': 100, 'change': 2}]


@pytest.mark.parametrize('market,hour,minute,opened', [
    ('TW', 9, 5, True), ('TW', 13, 35, False),
    ('HK', 10, 0, True), ('HK', 12, 15, False), ('HK', 13, 30, True),
    ('CN', 10, 0, True), ('CN', 12, 0, False), ('CN', 13, 30, True),
])
def test_local_trading_hours_and_lunch_breaks(market, hour, minute, opened):
    now = datetime(2026, 11, 11, hour, minute, tzinfo=ZoneInfo('Asia/Shanghai')).timestamp()
    assert (active_session(MARKET_CASH_CALENDARS[market], now) is not None) == opened


@pytest.mark.asyncio
@pytest.mark.parametrize('market,symbol,index', [('TW', '2330.TW', 'TWII'), ('HK', '0700.HK', 'HSI'), ('CN', '600519.SS', '000001.SS')])
async def test_routes_accept_markets_and_preserve_numeric_index_codes(market, symbol, index):
    app = FastAPI()
    app.include_router(router.router, prefix='/api')
    with patch.object(router, 'custom_data', return_value=None), \
            patch.object(router, 'get_symbols', return_value={symbol: 'Company'}), \
            patch.object(router, 'get_market_indices', return_value=[{'symbol': yahoo_symbol(index), 'price': 100}]), \
            patch.object(router, 'fetch_prices', return_value=[]):
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
            directory = await client.get(f'/api/stock-analysis/symbols/{market}')
            indices = await client.get(f'/api/stock-analysis/market-indices?market={market}')
            prices = await client.get(f'/api/stock-analysis/prices/{symbol}')
    assert directory.status_code == indices.status_code == prices.status_code == 200
    assert directory.json()[0]['symbol'] == symbol
    assert indices.json()[0]['symbol'] == index


@pytest.mark.parametrize('market,symbol,native,english', [
    ('TW', '2330.TW', '台積電', 'TAIWAN SEMICONDUCTOR MANUFACTUR'),
    ('HK', '0700.HK', '騰訊控股', 'TENCENT'),
    ('CN', '600519.SS', '贵州茅台', 'KWEICHOW MOUTAI'),
])
@pytest.mark.parametrize('language', ['zh', 'zh-TW', 'zh-CN', 'en', 'ko', 'ja', 'fr', 'es', 'vi', 'th'])
def test_chinese_names_only_in_chinese_ui(market, symbol, native, english, language):
    with patch.object(regional_yahoo, '_directory', return_value={symbol: {'shortName': english, 'longName': native}}) as directory:
        names = regional_yahoo.regional_display_names(market, language)
    chinese = language.startswith('zh')
    assert names[symbol] == (native if chinese else english)
    assert directory.call_args.args[1:] == ('zh' if chinese else 'en', market)


def test_sector_map_preserves_chinese_language_for_names():
    with patch.object(sector_map, '_load_map', return_value={}) as load:
        sector_map.get_sector_map('TW', 'zh-CN')
    assert load.call_args.args[-1] == 'zh'
