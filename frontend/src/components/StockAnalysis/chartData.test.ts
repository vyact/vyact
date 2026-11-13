import {describe, expect, it} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import {aggregatePrices, chartActivityField} from './chartData';
import {quoteChange} from './ChartQuoteDetails';

const bar = (day: string, volume: number | null): DailyPrice => ({
    day, open: 100, high: 110, low: 90, close: 105, volume,
});

describe('chart volume aggregation', () => {
    it('prefers trading value, including zero, without mixing missing days with volume', () => {
        expect(chartActivityField([bar('2026-06-01', 100)])).toBe('volume');
        expect(chartActivityField([{...bar('2026-06-01', null), tradingValue: 0}])).toBe('tradingValue');
        const rows = [{...bar('2026-06-01', 100), tradingValue: 500}, bar('2026-06-02', 200)];
        expect(chartActivityField(rows)).toBe('tradingValue');
        expect(aggregatePrices(rows, 'month')[0].tradingValue).toBeNull();
    });

    it.each(['week', 'month', 'year'] as const)('sums %s trading value and keeps the final balance and market cap', interval => {
        const rows = [
            {...bar('2026-06-01', 100), tradingValue: 10000, marketCap: 100000, sharesOutstanding: 1000, loanBalanceVolume: 10, loanBalanceAmount: 1000},
            {...bar('2026-06-02', 200), tradingValue: 20000, marketCap: 200000, sharesOutstanding: 2000, loanBalanceVolume: 20, loanBalanceAmount: 2000},
        ];
        expect(aggregatePrices(rows, interval)[0]).toMatchObject({tradingValue: 30000, marketCap: 200000, sharesOutstanding: 2000, loanBalanceVolume: 20, loanBalanceAmount: 2000});
        expect(rows[0].tradingValue).toBe(10000);
    });
    it.each([
        ['week', ['2026-06-01', '2026-06-05', '2026-06-08', '2026-06-12']],
        ['month', ['2026-05-01', '2026-05-29', '2026-06-01', '2026-06-30']],
        ['year', ['2025-01-02', '2025-12-31', '2026-01-02', '2026-11-09']],
    ] as const)('sums %s volumes and compares against the previous period total', (interval, days) => {
        const rows = days.map((day, index) => bar(day, [100, 200, 150, 300][index]));
        const periods = aggregatePrices(rows, interval);
        expect(periods.map(row => row.volume)).toEqual([300, 450]);
        expect(quoteChange(periods[1].volume, periods[0].volume)).toBeCloseTo(50);
        expect(rows[0].volume).toBe(100);
    });

    it('keeps missing volume unknown instead of displaying a partial total', () => {
        expect(aggregatePrices([bar('2026-06-01', 100), bar('2026-06-02', null)], 'month')[0].volume).toBeNull();
        expect(quoteChange(100, 0)).toBeNull();
        expect(aggregatePrices([bar('2026-06-01', 0), bar('2026-06-02', 100)], 'month')[0].volume).toBe(100);
    });
});
