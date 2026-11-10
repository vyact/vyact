import {assertOk} from '../utils/apiError';

export type FinancialFrequency = 'yearly' | 'quarterly';
export type StatementKind = 'income' | 'balance' | 'cashflow';
export interface FinancialPeriod {period: string; values: Record<string, number | null>}
export interface StockFinancialData {currency: string | null; statements: Record<StatementKind, FinancialPeriod[]>; checkedAt?: string; refreshing?: boolean; refreshFailed?: boolean; availability?: 'available' | 'empty'}
export const FINANCIAL_METRICS: Record<StatementKind, string[]> = {
    income: ['revenue', 'operatingIncome', 'netIncome', 'eps'],
    balance: ['assets', 'liabilities', 'equity', 'cash'],
    cashflow: ['operatingCashflow', 'investingCashflow', 'financingCashflow', 'freeCashflow'],
};
export async function getStockFinancials(symbol: string, frequency: FinancialFrequency, signal: AbortSignal, force = false): Promise<StockFinancialData> {
    const response = await fetch(`/api/stock-analysis/financials/${encodeURIComponent(symbol)}?frequency=${frequency}&force=${force}`, {signal});
    await assertOk(response);
    return response.json();
}
