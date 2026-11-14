import {describe, expect, it} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import {comparisonPeriodChange, comparisonPoints, comparisonReturns} from './comparisonData';

const price = (day: string, close: number): DailyPrice => ({day, open: close, high: close, low: close, close, volume: null});
const base = [price('2026-11-02', 1), price('2026-11-03', 2), price('2026-11-04', 3)];

describe('comparisonPoints', () => {
    it.each([
        ['week', '2026-06-05', '2026-06-08', '2026-06-12'],
        ['month', '2026-05-29', '2026-06-01', '2026-06-30'],
        ['year', '2025-12-31', '2026-01-02', '2026-11-09'],
    ] as const)('uses the previous %s close rather than the previous day', (interval, prior, first, last) => {
        const rows = [price(prior, 100), price(first, 150), price(last, 120)];
        expect(comparisonPeriodChange(rows, last, interval)).toBeCloseTo(20);
        expect(comparisonPeriodChange(rows, last, 'day')).toBeCloseTo(-20);
        expect(comparisonPeriodChange(rows, prior, interval)).toBeNull();
        const shifted = comparisonPoints(rows.filter(row => row.day !== last), rows, interval, 1);
        expect(comparisonPeriodChange(rows, shifted[shifted.length - 1].sourceDay, interval)).toBeCloseTo(20);
    });
    it('uses the source trading day before a shifted point, not the displayed day', () => {
        const rows = [price('2026-10-30', 100), price('2026-11-02', 110), price('2026-11-03', 99)];
        const point = comparisonPoints(base, rows, 'day', 1)[0];
        expect(point.time).toBe('2026-11-03');
        expect(comparisonPeriodChange(rows, point.sourceDay)).toBeCloseTo(10);
        expect(comparisonPeriodChange(rows, '2026-11-03')).toBeCloseTo(-10);
        expect(comparisonPeriodChange(rows, '2026-10-30')).toBeNull();
    });
    it('aligns by date instead of array index when a comparison session is missing', () => {
        expect(comparisonPoints(base, [price('2026-11-03', 20)], 'day', 0)).toEqual([
            {time: '2026-11-03', value: 20, sourceDay: '2026-11-03'},
        ]);
    });
    it('shifts by trading bars and preserves source dates without clipping the positive boundary', () => {
        expect(comparisonPoints(base, base, 'day', 1)).toEqual([
            {time: '2026-11-03', value: 1, sourceDay: '2026-11-02'},
            {time: '2026-11-04', value: 2, sourceDay: '2026-11-03'},
            {time: '2026-11-05', value: 3, sourceDay: '2026-11-04'},
        ]);
        expect(comparisonPoints(base, base, 'day', -2)).toEqual([
            {time: '2026-11-02', value: 3, sourceDay: '2026-11-04'},
        ]);
    });
    it('keeps the latest comparison close ten bars ahead, skipping weekends', () => {
        const points = comparisonPoints(base, base, 'day', 10);
        expect(points).toHaveLength(3);
        expect(points[2]).toEqual({time: '2026-11-18', value: 3, sourceDay: '2026-11-04'});
    });
    it('aligns weekly closes even when the markets have different first sessions', () => {
        expect(comparisonPoints([price('2026-11-02', 1), price('2026-11-09', 2)],
            [price('2026-11-03', 10), price('2026-11-06', 15), price('2026-11-10', 20)], 'week', 1)).toEqual([
            {time: '2026-11-09', value: 15, sourceDay: '2026-11-06'},
            {time: '2026-11-16', value: 20, sourceDay: '2026-11-10'},
        ]);
    });
});


describe('comparisonReturns', () => {
    it('rebases both symbols on a shared visible day with different prices', () => {
        const rows = [price('2026-11-02', 100), price('2026-11-03', 110), price('2026-11-04', 121)];
        const points = [{time: '2026-11-03', value: 200, sourceDay: '2026-11-03'}, {time: '2026-11-04', value: 180, sourceDay: '2026-11-04'}];
        const result = comparisonReturns(rows, points, '2026-11-02');
        expect(result.base[0]).toEqual({time: '2026-11-03', value: 0});
        expect(result.comparison[0].value).toBe(0);
        expect(result.base[1].value).toBeCloseTo(10);
        expect(result.comparison[1].value).toBeCloseTo(-10);
        expect(comparisonReturns(rows, points, '2026-11-04').base[0].value).toBe(0);
    });
    it('does not invent returns with missing sessions or zero baselines', () => {
        expect(comparisonReturns(base, [{time: '2027-01-01', value: 10, sourceDay: '2027-01-01'}])).toEqual({base: [], comparison: []});
        expect(comparisonReturns(base, [{time: base[0].day, value: 0, sourceDay: base[0].day}])).toEqual({base: [], comparison: []});
    });
});
