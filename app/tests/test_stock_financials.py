import unittest
from unittest.mock import patch

import pandas as pd

from services.stock_analysis.financials import _fetch_financials, fetch_financials, serialize_statement
from services.stock_analysis.financial_context import build_financial_chat_context


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


class FinancialChatContextTests(unittest.IsolatedAsyncioTestCase):
    async def test_indices_never_fetch_financials(self):
        with patch('services.stock_analysis.financial_context.get_financials') as fetch:
            self.assertEqual(await build_financial_chat_context('KS11'), '')
            fetch.assert_not_called()

    async def test_includes_both_frequencies_and_preserves_partial_success(self):
        data = {'currency': 'KRW', 'statements': {'income': [{'period': '2025-12-31', 'values': {'revenue': 123}}]}}
        with patch('services.stock_analysis.financial_context.get_financials', side_effect=[data, RuntimeError('unavailable')]):
            context = await build_financial_chat_context('005930')
        self.assertIn('yearly', context)
        self.assertIn('"revenue": 123', context)
        self.assertIn('quarterly): unavailable', context)
