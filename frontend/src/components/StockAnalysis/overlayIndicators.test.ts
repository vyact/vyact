import {describe, expect, it} from 'vitest';
import {calculateIndicator} from './technicalIndicators';
import {DEFAULT_INDICATOR_SETTINGS, validIndicatorSettings} from './indicatorSettings';
import type {DailyPrice} from '../../services/stockAnalysis';

const rows: DailyPrice[] = Array.from({length: 80}, (_, i) => ({
    day: new Date(Date.UTC(2026, 0, i + 1)).toISOString().slice(0, 10),
    open: i + 10, high: i + 12, low: i + 9, close: i + 11, volume: 100,
}));
describe('price overlays', () => {
    it('calculates population standard deviation bands', () => {
        const settings = structuredClone(DEFAULT_INDICATOR_SETTINGS);
        settings.bollinger = {period: 2, deviation: 2};
        const [middle, upper, lower] = calculateIndicator('bollinger', rows, settings);
        expect(middle.values[0]).toBeNull();
        expect(middle.values[1]).toBe(11.5);
        expect(upper.values[1]).toBe(12.5);
        expect(lower.values[1]).toBe(10.5);
    });
    it('calculates percentage envelopes', () => {
        const settings = structuredClone(DEFAULT_INDICATOR_SETTINGS);
        settings.envelope = {period: 1, percent: 10};
        const [, upper, lower] = calculateIndicator('envelope', rows, settings);
        expect(upper.values[0]).toBeCloseTo(12.1);
        expect(lower.values[0]).toBeCloseTo(9.9);
    });
    it('displaces Ichimoku leading and lagging spans in opposite directions', () => {
        const [conversion, base, a, b, lagging] = calculateIndicator('ichimoku', rows);
        expect(conversion.values[8]).toBe(14.5);
        expect(a.values[50]).toBeNull();
        expect(a.values[51]).toBe((conversion.values[25]! + base.values[25]!) / 2);
        expect(b.values[77]).not.toBeNull();
        expect(lagging.values[0]).toBe(rows[26].close);
        expect(lagging.values[79]).toBeNull();
    });
    it('keeps SAR below a rising trend and reverses above a downward break', () => {
        const data = rows.slice(0, 10);
        const values = calculateIndicator('sar', data)[0].values;
        expect(values[9]!).toBeLessThan(data[9].low);
        const reversed = calculateIndicator('sar', [...data, {...rows[10], high: 12, low: 1, close: 2}])[0].values;
        expect(reversed[10]).toBe(data[9].high);
    });
    it('validates decimal parameters and SAR acceleration ordering', () => {
        const settings = structuredClone(DEFAULT_INDICATOR_SETTINGS);
        expect(validIndicatorSettings(settings)).toBe(true);
        settings.sar.step = .3;
        expect(validIndicatorSettings(settings)).toBe(false);
    });
});
