import type {DailyPrice} from '../../services/stockAnalysis';

export const INTERVALS = ['day', 'week', 'month', 'year'] as const;
export type ChartInterval = typeof INTERVALS[number];
export type MovingAverage = {period: number; color: string};
export const DEFAULT_MOVING_AVERAGES: MovingAverage[] = [
    {period: 5, color: '#e85e97'},
    {period: 20, color: '#45a65a'},
    {period: 60, color: '#008cce'},
];
export const MAX_MA_PERIOD = 250;

export function chartActivityField(rows: DailyPrice[]): 'volume' | 'tradingValue' {
    return rows.some(row => row.tradingValue != null) ? 'tradingValue' : 'volume';
}

export function periodKey(day: string, interval: ChartInterval): string {
    if (interval === 'day') return day;
    if (interval === 'year') return day.slice(0, 4);
    if (interval === 'month') return day.slice(0, 7);
    const date = new Date(day);
    date.setUTCDate(date.getUTCDate() - (date.getUTCDay() + 6) % 7);
    return date.toISOString().slice(0, 10);
}

export function aggregatePrices(rows: DailyPrice[], interval: ChartInterval): DailyPrice[] {
    if (interval === 'day') return rows;
    const result: DailyPrice[] = [];
    let currentPeriod: string | undefined;
    for (const row of rows) {
        const period = periodKey(row.day, interval);
        if (currentPeriod !== period) {
            result.push({...row});
            currentPeriod = period;
            continue;
        }
        const current = result[result.length - 1];
        current.high = Math.max(current.high, row.high);
        current.low = Math.min(current.low, row.low);
        current.close = row.close;
        current.volume = current.volume === null || row.volume === null ? null : current.volume + row.volume;
        current.tradingValue = current.tradingValue == null || row.tradingValue == null ? null : current.tradingValue + row.tradingValue;
        current.sharesOutstanding = row.sharesOutstanding;
        current.marketCap = row.marketCap;
        current.loanBalanceVolume = row.loanBalanceVolume;
        current.loanBalanceAmount = row.loanBalanceAmount;
    }
    return result;
}

export function movingAverage(rows: DailyPrice[], period: number) {
    let total = 0;
    return rows.flatMap((row, index) => {
        total += row.close;
        if (index >= period) total -= rows[index - period].close;
        return index >= period - 1 ? [{time: row.day, value: total / period}] : [];
    });
}
