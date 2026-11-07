import unittest
from unittest.mock import patch

import pandas as pd

from services.stock_analysis.prices import fetch_prices


class StockPriceHistoryRangeTests(unittest.TestCase):
    @patch('services.stock_analysis.prices.yf.Ticker')
    def test_market_indices_request_full_history(self, ticker):
        ticker.return_value.history.return_value = pd.DataFrame()
        for symbol in ('^GSPC', '^IXIC', '^RUT'):
            with self.subTest(symbol=symbol):
                fetch_prices(symbol)
                self.assertEqual(ticker.return_value.history.call_args.kwargs['period'], 'max')
                self.assertEqual(ticker.return_value.history.call_args.kwargs['interval'], '1d')

    @patch('services.stock_analysis.prices.yf.Ticker')
    def test_stocks_keep_ten_year_history(self, ticker):
        ticker.return_value.history.return_value = pd.DataFrame()
        for symbol in ('MSFT', '005930.KS'):
            with self.subTest(symbol=symbol):
                fetch_prices(symbol)
                self.assertEqual(ticker.return_value.history.call_args.kwargs['period'], '10y')
