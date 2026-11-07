import {OVERLAY_INDICATORS, calculateOverlay, type OverlayIndicator} from './overlayIndicators';
import {DEFAULT_INDICATOR_SETTINGS, type IndicatorSettings} from './indicatorSettings';
import type {DailyPrice} from '../../services/stockAnalysis';

export const INDICATORS = ['macd', 'rsi', 'adx', 'obv', 'fastStochastic', 'slowStochastic', ...OVERLAY_INDICATORS] as const;
export type Indicator = typeof INDICATORS[number];
type Value = number | null;
export type IndicatorLine = {label: string; color: string; values: Value[]; histogram?: boolean};
const COLORS = {main: '#69b5ff', signal: '#e99b52', up: '#39b589', down: '#e76680'};

function smooth(values: Value[], period: number, alpha: number): Value[] {
    let seed: number[] = [];
    let previous: Value = null;
    return values.map(value => {
        if (value === null) {seed = []; previous = null; return null;}
        if (previous === null) {
            seed.push(value);
            if (seed.length < period) return null;
            previous = seed.reduce((sum, entry) => sum + entry, 0) / period;
        } else previous += alpha * (value - previous);
        return previous;
    });
}
function sma(values: Value[], period: number): Value[] {
    return values.map((_, index) => {
        const window = values.slice(Math.max(0, index - period + 1), index + 1);
        return window.length === period && window.every((value): value is number => value !== null)
            ? window.reduce((sum, value) => sum + value, 0) / period : null;
    });
}
const line = (label: string, values: Value[], color = COLORS.main): IndicatorLine => ({label, values, color});

export function calculateIndicator(kind: Indicator, rows: DailyPrice[], settings: IndicatorSettings = DEFAULT_INDICATOR_SETTINGS): IndicatorLine[] {
    const options = settings[kind];
    if (OVERLAY_INDICATORS.includes(kind as OverlayIndicator)) return calculateOverlay(kind as OverlayIndicator, rows, options);
    const period = options.period;
    const closes = rows.map(row => row.close);
    if (kind === 'macd') {
        const fast = smooth(closes, options.fast, 2 / (options.fast + 1));
        const slow = smooth(closes, options.slow, 2 / (options.slow + 1));
        const macd = fast.map((value, index) => value === null || slow[index] === null ? null : value - slow[index]!);
        const signal = smooth(macd, options.signal, 2 / (options.signal + 1));
        return [line(`MACD (${options.fast},${options.slow})`, macd), line(`Signal (${options.signal})`, signal, COLORS.signal),
            {...line('Histogram', macd.map((value, index) => value === null || signal[index] === null ? null : value - signal[index]!)), histogram: true}];
    }
    if (kind === 'rsi') {
        const changes = closes.map((value, index) => index ? value - closes[index - 1] : null);
        const gain = smooth(changes.map(value => value === null ? null : Math.max(0, value)), period, 1 / period);
        const loss = smooth(changes.map(value => value === null ? null : Math.max(0, -value)), period, 1 / period);
        return [line(`RSI (${period})`, gain.map((value, index) => value === null ? null : loss[index] === 0 ? (value === 0 ? 50 : 100) : 100 - 100 / (1 + value / loss[index]!)))];
    }
    if (kind === 'obv') {
        if (rows.some(row => row.volume === null)) return [line('OBV', rows.map(() => null))];
        let total = 0;
        return [line('OBV', rows.map((row, index) => {
            if (index) total += Math.sign(row.close - rows[index - 1].close) * row.volume!;
            return total;
        }))];
    }
    if (kind === 'adx') {
        const tr = rows.map((row, index) => index ? Math.max(row.high - row.low, Math.abs(row.high - rows[index - 1].close), Math.abs(row.low - rows[index - 1].close)) : null);
        const direction = (positive: boolean) => rows.map((row, index) => {
            if (!index) return null;
            const up = row.high - rows[index - 1].high;
            const down = rows[index - 1].low - row.low;
            return positive ? (up > down && up > 0 ? up : 0) : (down > up && down > 0 ? down : 0);
        });
        const atr = smooth(tr, period, 1 / period);
        const di = (positive: boolean) => smooth(direction(positive), period, 1 / period).map((value, index) => value === null ? null : atr[index] === 0 ? 0 : 100 * value / atr[index]!);
        const plus = di(true), minus = di(false);
        const dx = plus.map((value, index) => value === null ? null : value + minus[index]! === 0 ? 0 : 100 * Math.abs(value - minus[index]!) / (value + minus[index]!));
        return [line(`ADX (${period})`, smooth(dx, period, 1 / period)), line('+DI', plus, COLORS.up), line('−DI', minus, COLORS.down)];
    }
    const fastK = rows.map((row, index) => {
        if (index < period - 1) return null;
        const window = rows.slice(index - period + 1, index + 1);
        const high = Math.max(...window.map(row => row.high)), low = Math.min(...window.map(row => row.low));
        return high === low ? 50 : 100 * (row.close - low) / (high - low);
    });
    const k = kind === 'fastStochastic' ? fastK : sma(fastK, options.smoothing);
    return [line(`%K (${period}${options.smoothing ? `,${options.smoothing}` : ''})`, k), line(`%D (${options.signal})`, sma(k, options.signal), COLORS.signal)];
}
