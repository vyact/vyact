import unittest
from unittest.mock import patch

import pandas as pd

from services.stock_analysis.financials import _fetch_financials, fetch_financials, serialize_statement


class StockFinancialTests(unittest.TestCase):
    def test_serializes_dates_missing_values_and_nonfinite_numbers(self):
        frame = pd.DataFrame(
            {pd.Timestamp('2025-12-31'): [123.0, float('nan')], pd.Timestamp('2024-12-31'): [100.0, float('inf')]},
            index=['Total Revenue', 'Net Income'],
        )
        rows = serialize_statement(frame, {'revenue': 'Total Revenue', 'netIncome': 'Net Income', 'eps': 'Diluted EPS'})
        self.assertEqual([row['period'] for row in rows], ['2025-12-31', '2024-12-31'])
        self.assertEqual(rows[0]['values'], {'revenue': 123.0, 'netIncome': None, 'eps': None})
        self.assertIsNone(rows[1]['values']['netIncome'])

    @patch('services.stock_analysis.financials.yf.Ticker')
    def test_indices_do_not_request_company_statements(self, ticker):
        result = fetch_financials('KS11', 'yearly')
        ticker.assert_not_called()
        self.assertTrue(all(not rows for rows in result['statements'].values()))

    @patch('services.stock_analysis.financials.yf.Ticker')
    def test_requests_readable_field_names_for_every_statement(self, ticker):
        _fetch_financials.cache_clear()
        frame = pd.DataFrame({pd.Timestamp('2025-12-31'): [123.0]}, index=['Total Assets'])
        instance = ticker.return_value
        instance.get_income_stmt.return_value = pd.DataFrame()
        instance.get_balance_sheet.return_value = frame
        instance.get_cashflow.return_value = pd.DataFrame()
        instance.get_info.return_value = {'financialCurrency': 'KRW'}
        result = _fetch_financials('MSFT', 'quarterly', 0)
        self.assertEqual(result['statements']['balance'][0]['values']['assets'], 123.0)
        for method in (instance.get_income_stmt, instance.get_balance_sheet, instance.get_cashflow):
            method.assert_called_once_with(freq='quarterly', pretty=True)
        _fetch_financials.cache_clear()
