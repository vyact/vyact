import type {DailyPrice, StockInvestorGroup, StockInvestorTrade} from '../../services/stockAnalysis';

export const INVESTOR_GROUPS: StockInvestorGroup[] = ['ind', 'for', 'ins', 'pen', 'itc', 'pef', 'fin', 'sur', 'bng', 'etc', 'cor', 'eor'];
export const HISTORY_PERIODS = [5, 20, 60, 120, 250] as const;
export const HISTORY_PAGE_SIZE = 50;
export const INVESTOR_METRICS = ['netAmount', 'netVolume', 'buyAverage', 'sellAverage'] as const;
export type InvestorMetric = typeof INVESTOR_METRICS[number];
export const isFiniteValue = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

export function tradeValue(trade: StockInvestorTrade | undefined, field: keyof StockInvestorTrade): number | null {
    if (!trade) return null;
    if (isFiniteValue(trade[field])) return trade[field];
    if (field === 'netAmount' || field === 'netVolume') {
        const buy = trade[field === 'netAmount' ? 'buyAmount' : 'buyVolume'];
        const sell = trade[field === 'netAmount' ? 'sellAmount' : 'sellVolume'];
        if (isFiniteValue(buy) && isFiniteValue(sell)) return Math.abs(buy) - Math.abs(sell);
    }
    return null;
}

function weightedPrice(rows: DailyPrice[], group: StockInvestorGroup, side: 'buy' | 'sell') {
    let amount = 0;
    let volume = 0;
    let days = 0;
    for (const row of rows) {
        const trade = row.investors?.[group];
        const dayAmount = trade?.[side === 'buy' ? 'buyAmount' : 'sellAmount'];
        const dayVolume = trade?.[side === 'buy' ? 'buyVolume' : 'sellVolume'];
        if (!isFiniteValue(dayAmount) || !isFiniteValue(dayVolume) || dayVolume === 0) continue;
        amount += Math.abs(dayAmount);
        volume += Math.abs(dayVolume);
        days++;
    }
    return {value: volume ? amount / volume : null, days};
}

export function investorSummary(rows: DailyPrice[], group: StockInvestorGroup, metric: InvestorMetric) {
    if (metric === 'buyAverage' || metric === 'sellAverage') return weightedPrice(rows, group, metric === 'buyAverage' ? 'buy' : 'sell');
    const values = rows.map(row => tradeValue(row.investors?.[group], metric)).filter(isFiniteValue);
    return {value: values.length ? values.reduce((total, value) => total + value, 0) : null, days: values.length};
}

export function availableInvestorGroups(rows: DailyPrice[]) {
    return INVESTOR_GROUPS.filter(group => rows.some(row => Object.values(row.investors?.[group] ?? {}).some(isFiniteValue)));
}

/** Prefer the provider's rate; derive only from the preceding available session. */
export function historyChangePercent(row: DailyPrice, previous?: DailyPrice): number | null {
    if (isFiniteValue(row.changePercent)) return row.changePercent;
    return previous && isFiniteValue(previous.close) && previous.close > 0
        ? (row.close / previous.close - 1) * 100 : null;
}

export const INVESTOR_SUMMARY_PERIODS = [1, ...HISTORY_PERIODS] as const;

export function investorPeriodStats(rows: DailyPrice[], group: StockInvestorGroup) {
    const netVolume = investorSummary(rows, group, 'netVolume').value;
    const netAmount = investorSummary(rows, group, 'netAmount').value;
    const average = netVolume === null || netVolume === 0 ? null
        : investorSummary(rows, group, netVolume > 0 ? 'buyAverage' : 'sellAverage').value;
    return {netVolume, netAmount, averagePrice: netVolume === 0 ? 0
        : average === null ? null : Math.round(average) * (netVolume !== null && netVolume > 0 ? 1 : -1)};
}
