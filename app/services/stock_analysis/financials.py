import math
from functools import lru_cache
from time import time

import yfinance as yf

from services.stock_analysis.symbols import is_market_index, yahoo_symbol

FINANCIAL_CACHE_SECONDS = 3600
STATEMENT_METRICS = {
    'income': {'revenue': 'Total Revenue', 'operatingIncome': 'Operating Income', 'netIncome': 'Net Income', 'eps': 'Diluted EPS'},
    'balance': {'assets': 'Total Assets', 'liabilities': 'Total Liabilities Net Minority Interest', 'equity': 'Stockholders Equity', 'cash': 'Cash And Cash Equivalents'},
    'cashflow': {'operatingCashflow': 'Operating Cash Flow', 'investingCashflow': 'Investing Cash Flow', 'financingCashflow': 'Financing Cash Flow', 'freeCashflow': 'Free Cash Flow'},
}


def serialize_statement(frame, metrics):
    rows = []
    if frame is None or frame.empty:
        return rows
    for period in sorted(frame.columns, reverse=True):
        values = {}
        for key, source in metrics.items():
            value = frame.at[source, period] if source in frame.index else None
            values[key] = float(value) if value is not None and math.isfinite(float(value)) else None
        rows.append({'period': period.date().isoformat(), 'values': values})
    return rows


@lru_cache(maxsize=128)
def _fetch_financials(symbol, frequency, cache_bucket):
    ticker = yf.Ticker(yahoo_symbol(symbol))
    statements = {
        'income': ticker.get_income_stmt(freq=frequency, pretty=True),
        'balance': ticker.get_balance_sheet(freq=frequency, pretty=True),
        'cashflow': ticker.get_cashflow(freq=frequency, pretty=True),
    }
    # Currency metadata is required to avoid presenting KRW and USD as comparable units.
    currency = ticker.get_info().get('financialCurrency')
    return {'currency': currency, 'statements': {
        key: serialize_statement(frame, STATEMENT_METRICS[key]) for key, frame in statements.items()
    }}


def fetch_financials(symbol, frequency, *, force=False):
    if is_market_index(symbol):
        return {'currency': None, 'statements': {key: [] for key in STATEMENT_METRICS}}
    if force:
        return _fetch_financials.__wrapped__(symbol, frequency, 0)
    return _fetch_financials(symbol, frequency, int(time() // FINANCIAL_CACHE_SECONDS))
