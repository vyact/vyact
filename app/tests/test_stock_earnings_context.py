from unittest.mock import AsyncMock, patch

import pytest
from pydantic import ValidationError

from services.stock_analysis import financial_context
from services.stock_analysis.earnings_context import build_earnings_context, missing_earnings_periods, supplement_financial_statements
from services.stock_analysis.api_settings import RESPONSE_ADAPTERS, ApiEndpoint, build_api_request


def earnings(period='2026-09-30', frequency='quarterly'):
    return {'frequency': frequency, 'period': period, 'fiscalYear': 2026,
            'fiscalQuarter': 3 if frequency == 'quarterly' else None,
            'source': 'DART', 'currency': 'KRW', 'preliminary': True,
            'receiptDate': '2026-10-29', 'originLink': 'https://dart.fss.or.kr/',
            'values': {'revenue': 100, 'netIncomeParent': -10}}


@pytest.mark.asyncio
async def test_statement_supplement_preserves_yahoo_and_frequency_without_mutation():
    yahoo = {'currency': 'KRW', 'statements': {'income': [
        {'period': '2026-06-30', 'values': {'revenue': 0}}], 'balance': [], 'cashflow': []}}
    rows = [earnings('2026-06-30'), earnings(), earnings('2025-12-31', 'yearly')]
    with patch('services.stock_analysis.earnings_context.custom_data', new=AsyncMock(return_value=rows)):
        result = await supplement_financial_statements('005930', 'quarterly', yahoo)
    assert [row['period'] for row in result['statements']['income']] == ['2026-09-30', '2026-06-30']
    assert result['statements']['income'][0]['source'] == 'DART'
    assert result['statements']['income'][1]['values']['revenue'] == 0
    assert len(yahoo['statements']['income']) == 1


@pytest.mark.asyncio
async def test_statement_supplement_failure_keeps_yahoo():
    yahoo = {'currency': 'KRW', 'statements': {'income': [], 'balance': [], 'cashflow': []}}
    with patch('services.stock_analysis.earnings_context.custom_data', new=AsyncMock(side_effect=RuntimeError())):
        assert await supplement_financial_statements('005930', 'quarterly', yahoo) is yahoo


def test_missing_periods_keep_annual_and_quarterly_distinct_and_deduplicate():
    yahoo = [{'statements': {'income': [{'period': '2026-09-30', 'values': {'revenue': 99}}]}}, RuntimeError()]
    quarterly = earnings()
    assert missing_earnings_periods([earnings(frequency='yearly'), quarterly, quarterly], yahoo) == [quarterly]


def test_empty_yahoo_and_zero_earnings_are_not_missing_numbers():
    row = earnings(); row['values'] = {'revenue': 0}
    yahoo = [RuntimeError(), {'statements': {'income': [{'period': row['period'], 'values': {'revenue': None}}]}}]
    assert missing_earnings_periods([row], yahoo) == [row]
    yahoo[1]['statements']['income'][0]['values']['revenue'] = 0
    assert missing_earnings_periods([row], yahoo) == []


@pytest.mark.asyncio
async def test_korean_earnings_reach_context_with_source_and_preliminary_warning():
    with patch('services.stock_analysis.earnings_context.custom_data', new=AsyncMock(return_value=[earnings()])) as api:
        text, available = await build_earnings_context('005930', [RuntimeError(), RuntimeError()])
    api.assert_awaited_once_with('KR', 'earnings', symbol='005930')
    assert available and 'netIncomeParent' in text and 'provisional' in text and 'https://dart.fss.or.kr/' in text


@pytest.mark.asyncio
async def test_other_markets_do_not_call_dart_and_failures_are_explicit():
    with patch('services.stock_analysis.earnings_context.custom_data', new=AsyncMock(side_effect=RuntimeError())) as api:
        assert await build_earnings_context('AAPL', []) == ('', True)
        api.assert_not_awaited()
        text, available = await build_earnings_context('005930', [])
    assert not available and 'unavailable' in text


def test_api_contract_rejects_other_sources_and_sends_symbol_and_market():
    adapter = RESPONSE_ADAPTERS['earnings']
    assert len(adapter.validate_python([earnings()])) == 1
    row = earnings(); row['source'] = 'Yahoo'
    with pytest.raises(ValidationError):
        adapter.validate_python([row])
    url, _ = build_api_request(ApiEndpoint(url='https://example.com/earnings'), 'earnings', {'symbol': '005930', 'market': 'KR'})
    assert 'symbol=005930' in url and 'market=KR' in url


@pytest.mark.asyncio
async def test_supplement_is_included_in_financial_prompt_without_overwriting_yahoo():
    yahoo = {'currency': 'KRW', 'statements': {'income': [
        {'period': '2026-06-30', 'values': {'revenue': 90}}]}}
    with patch.object(financial_context, 'get_financials', new=AsyncMock(return_value=yahoo)), \
            patch('services.stock_analysis.earnings_context.custom_data', new=AsyncMock(return_value=[earnings()])):
        text = await financial_context.build_financial_chat_context('005930')
    assert '"revenue": 90' in text and '"revenue": 100' in text
    assert 'Yahoo Finance' in text and 'Vyvow / DART' in text
    assert yahoo['statements']['income'][0]['period'] == '2026-06-30'
