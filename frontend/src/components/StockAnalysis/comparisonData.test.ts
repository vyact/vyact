import {describe, expect, it} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import {comparisonDailyChange, comparisonPoints} from './comparisonData';

const price = (day: string, close: number): DailyPrice => ({day, open: close, high: close, low: close, close, volume: null});
const base = [price('2026-11-02', 1), price('2026-11-03', 2), price('2026-11-04', 3)];

describe('comparisonPoints', () => {
    it('uses the source trading day before a shifted point, not the displayed day', () => {
        const rows = [price('2026-10-30', 100), price('2026-11-02', 110), price('2026-11-03', 99)];
        const point = comparisonPoints(base, rows, 'day', 1)[0];
        expect(point.time).toBe('2026-11-03');
        expect(comparisonDailyChange(rows, point.sourceDay)).toBeCloseTo(10);
        expect(comparisonDailyChange(rows, '2026-11-03')).toBeCloseTo(-10);
        expect(comparisonDailyChange(rows, '2026-10-30')).toBeNull();
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
