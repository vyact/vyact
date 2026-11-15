from unittest.mock import patch

from services.stock_analysis import global_indicators as indicators


def setup_function():
    indicators._cache.clear()


def test_closed_markets_reuse_quotes_until_next_open():
    with patch.object(indicators, '_safe_fetch_index', side_effect=lambda symbol: {'symbol': symbol, 'price': 100}) as fetch, \
            patch.object(indicators, 'active_session', return_value=None), \
            patch.object(indicators, 'next_regular_open', return_value=10000), \
            patch.object(indicators, 'time', return_value=120):
        first = indicators.get_global_indicators()
        indicators.get_global_indicators()
        assert fetch.call_count == 5
        assert all(quote['nextRefreshAt'] == 10000 for quote in first)
        with patch.object(indicators, 'time', return_value=500):
            indicators.get_global_indicators()
            assert fetch.call_count == 5
        with patch.object(indicators, 'time', return_value=10001):
            indicators.get_global_indicators()
            assert fetch.call_count == 10


def test_open_markets_refresh_every_minute():
    with patch.object(indicators, '_safe_fetch_index', return_value={'price': 100}) as fetch, \
            patch.object(indicators, 'active_session', return_value=(100, 10000)), \
            patch.object(indicators, 'time', return_value=120):
        indicators.get_global_indicators()
        with patch.object(indicators, 'time', return_value=179):
            indicators.get_global_indicators()
            assert fetch.call_count == 5
        with patch.object(indicators, 'time', return_value=180):
            indicators.get_global_indicators()
            assert fetch.call_count == 10


def test_failed_refresh_keeps_last_quote_and_retries():
    indicators._cache['^VIX'] = {'price': 100, 'nextRefreshAt': 100}
    with patch.object(indicators, '_safe_fetch_index', return_value={'price': None}), \
            patch.object(indicators, '_session_refresh', return_value=10000), \
            patch.object(indicators, 'time', return_value=120):
        quote = indicators._quote('^VIX')
        assert quote['price'] == 100
        assert quote['stale']
        assert quote['nextRefreshAt'] == 420


def test_delayed_closing_quotes_are_refreshed():
    with patch.object(indicators, 'active_session', side_effect=[None, (0, 100)]), \
            patch.object(indicators, 'next_regular_open') as opening:
        assert indicators._session_refresh('GC=F', 1200) == 1260
        opening.assert_not_called()
