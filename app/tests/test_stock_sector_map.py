import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from services.stock_analysis import sector_map
from services.stock_analysis.market_group_cache import parse_us_holdings


class StockSectorMapTests(unittest.TestCase):
    def setUp(self):
        self.session_patch = patch.object(sector_map, 'us_premarket_window', return_value=None)
        self.session_patch.start()
        self.addCleanup(self.session_patch.stop)
        self.industries = {}
        self.industry_patch = patch.object(sector_map, 'get_us_market_groups', side_effect=lambda client: parse_us_holdings(client.get.return_value.text, self.industries))
        self.industry_patch.start()
        self.addCleanup(self.industry_patch.stop)

    def test_sector_limits_use_largest_market_caps_and_matching_aggregate(self):
        stocks = [dict(symbol=str(index), weight=index, change=index) for index in range(1, 21)]
        sector = sector_map._sectors({"Technology": stocks})[0]
        self.assertEqual([stock["weight"] for stock in sector["stocks"]], list(range(20, 5, -1)))
        self.assertEqual(sector["weight"], sum(range(6, 21)))
        self.assertAlmostEqual(sector["change"], sum(i * i for i in range(6, 21)) / sum(range(6, 21)))

    @patch.object(sector_map, "YfData")
    def test_daily_quote_uses_latest_session_and_previous_valid_close(self, data):
        timestamps = [int(datetime(2026, 11, day, 21, tzinfo=timezone.utc).timestamp()) for day in (4, 5, 6)]
        data.return_value.get_raw_json.return_value = {"chart": {"result": [{
            "meta": {"gmtoffset": -18000}, "timestamp": timestamps,
            "indicators": {"quote": [{"close": [100, None, 110]}]},
        }]}}
        symbol, quote = sector_map._us_daily_quote("MSFT")
        self.assertEqual(symbol, "MSFT")
        self.assertEqual(quote[:2], ("2026-11-06", 110))
        self.assertAlmostEqual(quote[2], 10)

    @patch.object(sector_map, "_us_daily_quote")
    @patch.object(sector_map, "_us_quotes")
    def test_us_map_separates_holdings_date_and_prices_and_uses_company_cap(self, quotes, daily):
        response = Mock()
        response.text = ('Fund Holdings as of,"Nov 05, 2026"\n'
                         'Ticker,Name,Sector,Asset Class,Market Value\n'
                         'AAA,Alpha,Technology,Equity,999\n'
                         'BBB,Beta,Technology,Equity,1\n')
        client = Mock()
        client.get.return_value = response
        quotes.return_value = {"AAA": ("2026-11-05", 100, 1, 1000), "BBB": ("2026-11-05", 100, 1, 2000)}
        daily.side_effect = lambda symbol: (symbol, ("2026-11-06", 110, 10))
        result = sector_map._us_map(client)
        self.assertEqual(result["date"], "2026-11-05")
        self.assertEqual(result["quoteDate"], "2026-11-06")
        self.assertEqual([stock["symbol"] for stock in result["sectors"][0]["stocks"]], ["BBB", "AAA"])
        self.assertTrue(all(stock["price"] == 110 for stock in result["sectors"][0]["stocks"]))

    @patch.object(sector_map, "YfData")
    def test_apple_november_six_close_and_change(self, data):
        timestamps = [int(datetime(2026, 11, day, 14, 30, tzinfo=timezone.utc).timestamp()) for day in (5, 6)]
        data.return_value.get_raw_json.return_value = {"chart": {"result": [{
            "meta": {"gmtoffset": -18000}, "timestamp": timestamps,
            "indicators": {"quote": [{"close": [344.17, 342.37]}]},
        }]}}
        _, quote = sector_map._us_daily_quote("AAPL")
        self.assertEqual(quote[:2], ("2026-11-06", 342.37))
        self.assertEqual(round(quote[2], 2), -0.52)

    @patch.object(sector_map, 'korea_symbols', return_value={'005930.KS': 'Samsung', '000660.KS': 'SK hynix'})
    @patch.object(sector_map, 'get_korea_sector_members', return_value={'Technology': ['005930.KS', '000660.KS']})
    @patch.object(sector_map, '_us_quotes', return_value={
        '005930.KS': ('2026-11-06', 188700, -6.35, 1200000),
        '000660.KS': ('2026-11-06', 1132000, -10.44, 800000),
    })
    def test_korean_map_uses_yahoo_quotes_and_sector_groups(self, quotes, members, names):
        client = Mock()
        result = sector_map._regional_map("KR")
        client.get.assert_not_called()
        self.assertEqual(result['quoteDate'], '2026-11-06')
        self.assertEqual(result['sectors'][0]['name'], 'Technology')
        self.assertEqual(result['sectors'][0]['stocks'][0]['price'], 188700)

    def test_premarket_uses_regular_close_and_rejects_old_or_invalid_quotes(self):
        window = (1000, 2000)
        raw = {'preMarketPrice': 179.38, 'preMarketTime': 1500, 'regularMarketPrice': 178.67, 'regularMarketTime': 900}
        result = sector_map._premarket_quote(raw, window, 1600, 178.67)
        self.assertAlmostEqual(result['change'], (179.38 / 178.67 - 1) * 100)
        self.assertEqual(result['price'], 179.38)
        for invalid in ({'preMarketTime': 999}, {'preMarketTime': 2000}, {'preMarketTime': 1700},
                        {'preMarketPrice': float('nan')}, {'preMarketPrice': 0}, {'preMarketTime': True},
                        {'regularMarketPrice': 170}, {'regularMarketTime': 1100}):
            with self.subTest(invalid=invalid):
                self.assertIsNone(sector_map._premarket_quote({**raw, **invalid}, window, 1600, 178.67))

    @patch.object(sector_map, '_us_daily_quote', return_value=('^GSPC', ('2026-11-09', 100, 1)))
    @patch.object(sector_map, '_us_quotes')
    def test_premarket_map_keeps_history_and_marks_missing_quotes_neutral(self, quotes, daily):
        response = Mock()
        response.text = ('Fund Holdings as of,"Nov 09, 2026"\n'
                         'Ticker,Name,Sector,Asset Class,Market Value\n'
                         'NVDA,NVIDIA,Technology,Equity,999\n'
                         'AAPL,Apple,Technology,Equity,999\n')
        client = Mock()
        client.get.return_value = response
        def fetch(symbols, *, details=None):
            details['NVDA'] = {'regularMarketPrice': 178.67, 'regularMarketTime': 900, 'preMarketPrice': 179.38, 'preMarketTime': 1500}
            return {'NVDA': ('2026-11-09', 178.67, -4.27, 2000), 'AAPL': ('2026-11-09', 350.69, 2.43, 1000)}
        quotes.side_effect = fetch
        with patch.object(sector_map, 'us_premarket_window', return_value=(1000, 2000)), patch.object(sector_map, 'time', return_value=1600):
            result = sector_map._us_map(client)
        self.assertEqual(result['session'], 'premarket')
        self.assertEqual(result['quoteDate'], '2026-11-09')
        nvda, apple = result['sectors'][0]['stocks']
        self.assertAlmostEqual(nvda['change'], 0.3973806469748644)
        self.assertEqual(nvda['regularChange'], -4.27)
        self.assertEqual(nvda['regularPrice'], 178.67)
        self.assertIsNone(apple['price'])
        self.assertIsNone(apple['change'])
        self.assertEqual(apple['regularPrice'], 350.69)
        self.assertEqual(result['sectors'][0]['change'], nvda['change'])

    @patch.object(sector_map, 'YfData')
    def test_batch_quote_captures_premarket_without_an_extra_provider_request(self, data):
        quote = {'symbol': 'NVDA', 'regularMarketTime': 1794258000, 'regularMarketPrice': 178.67,
                 'regularMarketChangePercent': -4.27, 'marketCap': 1000000, 'preMarketPrice': 179.38,
                 'preMarketTime': 1794310000, 'gmtOffSetMilliseconds': -18000000}
        data.return_value.get_raw_json.return_value = {'quoteResponse': {'result': [quote]}}
        details = {}
        regular = sector_map._us_quotes(['NVDA'], details=details)
        self.assertEqual(details['NVDA']['preMarketPrice'], 179.38)
        self.assertEqual(regular['NVDA'][1], 178.67)
        data.return_value.get_raw_json.assert_called_once()

    def test_unlimited_sectors_retain_smaller_industries_and_market_cap_totals(self):
        stocks = [dict(symbol=str(index), weight=index, change=1, industry='Small' if index < 3 else 'Large') for index in range(1, 21)]
        sector = sector_map._sectors({'Technology': stocks}, limit=None)[0]
        self.assertEqual(len(sector['stocks']), 20)
        self.assertEqual(sector['weight'], sum(range(1, 21)))
        self.assertTrue(any(stock['industry'] == 'Small' for stock in sector['stocks']))

    @patch.object(sector_map, '_us_daily_quote', return_value=('^GSPC', ('2026-11-09', 100, 1)))
    @patch.object(sector_map, '_us_quotes')
    def test_us_map_preserves_all_holdings_and_matches_industries(self, quotes, daily):
        response = Mock()
        response.text = ('Fund Holdings as of,"Nov 09, 2026"\n'
                         'Ticker,Name,Sector,Asset Class,Market Value\n'
                         + ''.join(f'T{index},Name{index},Technology,Equity,999\n' for index in range(20)))
        client = Mock()
        client.get.return_value = response
        quotes.return_value = {f'T{index}': ('2026-11-09', 100, 1, index + 1) for index in range(20)}
        with patch.dict(self.industries, {'T0': 'Small industry'}):
            result = sector_map._us_map(client)
        stocks = result['sectors'][0]['stocks']
        self.assertEqual(len(stocks), 20)
        self.assertEqual(next(stock for stock in stocks if stock['symbol'] == 'T0')['industry'], 'Small industry')
        self.assertIsNone(next(stock for stock in stocks if stock['symbol'] == 'T1')['industry'])
