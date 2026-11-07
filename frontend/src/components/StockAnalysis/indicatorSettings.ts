import type {Indicator} from './technicalIndicators';
export const INDICATOR_SETTINGS_KEY = 'vyact:stock-analysis:indicator-settings:v1';
export const MAX_INDICATOR_PERIOD = 250;
export const DEFAULT_INDICATOR_SETTINGS = {
    macd: {fast: 12, slow: 26, signal: 9},
    rsi: {period: 14, lower: 30, upper: 70},
    adx: {period: 14, threshold: 25},
    obv: {},
    bollinger: {period: 20, deviation: 2},
    ichimoku: {conversion: 9, base: 26, span: 52, displacement: 26},
    sar: {step: 0.02, maximum: 0.2},
    envelope: {period: 20, percent: 2.5},
    fastStochastic: {period: 14, signal: 3, lower: 20, upper: 80},
    slowStochastic: {period: 14, smoothing: 3, signal: 3, lower: 20, upper: 80},
};
export type IndicatorSettings = Record<Indicator, Record<string, number>>;
export function validIndicatorSettings(settings: IndicatorSettings): boolean {
    return Object.entries(DEFAULT_INDICATOR_SETTINGS).every(([kind, defaults]) => {
        const values = settings[kind as Indicator];
        if (!values) return false;
        if (!Object.keys(defaults).every(key => Number.isFinite(values[key]) &&
            (['deviation', 'percent', 'step', 'maximum'].includes(key) ? values[key] > 0 && values[key] <= (['step', 'maximum'].includes(key) ? 1 : 100) : ['lower', 'upper', 'threshold'].includes(key) ? values[key] >= 0 && values[key] <= 100 :
                Number.isInteger(values[key]) && values[key] >= 1 && values[key] <= MAX_INDICATOR_PERIOD))) return false;
        return (!('lower' in defaults) || values.lower < values.upper) && (kind !== 'macd' || values.fast < values.slow) && (kind !== 'sar' || values.step <= values.maximum);
    });
}
export function readIndicatorSettings(): IndicatorSettings {
    try {
        const saved = JSON.parse(localStorage.getItem(INDICATOR_SETTINGS_KEY) ?? 'null');
        if (saved) {
            const merged = Object.fromEntries(Object.entries(DEFAULT_INDICATOR_SETTINGS).map(([kind, defaults]) => [kind, {...defaults, ...saved[kind]}])) as IndicatorSettings;
            if (validIndicatorSettings(merged)) return merged;
        }
    } catch { /* Use defaults for unavailable or invalid storage. */ }
    return structuredClone(DEFAULT_INDICATOR_SETTINGS);
}
