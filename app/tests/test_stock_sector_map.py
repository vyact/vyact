import unittest
from datetime import datetime, timezone
from unittest.mock import Mock, patch

from services.stock_analysis import sector_map


class StockSectorMapTests(unittest.TestCase):
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
