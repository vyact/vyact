import {describe, expect, it} from 'vitest';
import type {DailyPrice} from '../../services/stockAnalysis';
import {calculateIndicator, INDICATORS} from './technicalIndicators';
import {DEFAULT_INDICATOR_SETTINGS, validIndicatorSettings} from './indicatorSettings';

const rows: DailyPrice[] = Array.from({length: 80}, (_, index) => ({
    day: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10),
    open: index + 10, high: index + 12, low: index + 9, close: index + 11, volume: 100,
}));
describe('technical indicators', () => {
    it('uses edited periods and rejects invalid settings', () => {
        const settings = structuredClone(DEFAULT_INDICATOR_SETTINGS);
        settings.rsi.period = 3;
        settings.macd = {fast: 3, slow: 5, signal: 2};
        expect(calculateIndicator('rsi', rows, settings)[0].values[3]).toBe(100);
        expect(calculateIndicator('macd', rows, settings)[0].values[4]).toBeCloseTo(1);
        expect(validIndicatorSettings(settings)).toBe(true);
        settings.macd.fast = 6;
        expect(validIndicatorSettings(settings)).toBe(false);
        settings.macd.fast = 3;
        settings.rsi.lower = settings.rsi.upper;
        expect(validIndicatorSettings(settings)).toBe(false);
        expect(DEFAULT_INDICATOR_SETTINGS.rsi.period).toBe(14);
    });
    it('returns finite, aligned output for all indicators and handles insufficient history', () => {
        for (const kind of INDICATORS) {
            for (const data of [[], rows.slice(0, 2), rows]) {
                for (const line of calculateIndicator(kind, data)) {
                    expect(line.values.length).toBeGreaterThanOrEqual(data.length);
                    expect(line.values.length).toBeLessThanOrEqual(data.length + 26);
                    expect(line.values.every(value => value === null || Number.isFinite(value))).toBe(true);
                }
            }
        }
    });
    it('calculates RSI and Wilder ADX for a consistently rising series', () => {
        const rsi = calculateIndicator('rsi', rows)[0].values;
        expect(rsi.slice(0, 14).every(value => value === null)).toBe(true);
        expect(rsi[14]).toBe(100);
        const adx = calculateIndicator('adx', rows)[0].values;
        expect(adx[26]).toBeNull();
        expect(adx[27]).toBe(100);
    });
    it('seeds MACD and signal only after their full lookback periods', () => {
        const [macd, signal, histogram] = calculateIndicator('macd', rows);
        expect(macd.values[24]).toBeNull();
        expect(macd.values[25]).toBeCloseTo(7);
        expect(signal.values[32]).toBeNull();
        expect(signal.values[33]).toBeCloseTo(7);
        expect(histogram.values[33]).toBeCloseTo(0);
    });
    it('tracks OBV direction and refuses missing-volume data', () => {
        expect(calculateIndicator('obv', rows.slice(0, 3))[0].values).toEqual([0, 100, 200]);
        expect(calculateIndicator('obv', [{...rows[0], volume: null}])[0].values).toEqual([null]);
    });
    it('smooths stochastic K and D at the correct offsets', () => {
        const fast = calculateIndicator('fastStochastic', rows);
        const slow = calculateIndicator('slowStochastic', rows);
        expect(fast[0].values[12]).toBeNull();
        expect(fast[0].values[13]).toBeCloseTo(93.75);
        expect(fast[1].values[14]).toBeNull();
        expect(slow[0].values[15]).toBeCloseTo(93.75);
        expect(slow[1].values[16]).toBeNull();
        expect(slow[1].values[17]).toBeCloseTo(93.75);
    });
    it('handles flat prices without division by zero', () => {
        const flat = rows.map(row => ({...row, open: 10, close: 10, high: 10, low: 10}));
        expect(calculateIndicator('rsi', flat)[0].values[14]).toBe(50);
        expect(calculateIndicator('adx', flat)[0].values[27]).toBe(0);
        expect(calculateIndicator('fastStochastic', flat)[0].values[13]).toBe(50);
    });
});
