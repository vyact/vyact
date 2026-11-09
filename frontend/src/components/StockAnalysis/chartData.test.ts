import {describe, expect, it} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import {aggregatePrices} from './chartData';
import {quoteChange} from './ChartQuoteDetails';

const bar = (day: string, volume: number | null): DailyPrice => ({
    day, open: 100, high: 110, low: 90, close: 105, volume,
});

describe('chart volume aggregation', () => {
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
