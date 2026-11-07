import type {DailyPrice} from '../../services/stockAnalysis';
import type {IndicatorLine} from './technicalIndicators';
export const OVERLAY_INDICATORS = ['bollinger', 'ichimoku', 'sar', 'envelope'] as const;
export type OverlayIndicator = typeof OVERLAY_INDICATORS[number];
export function calculateOverlay(kind: OverlayIndicator, rows: DailyPrice[], options: Record<string, number>): IndicatorLine[] {
    const line = (label: string, values: (number | null)[], color: string): IndicatorLine => ({label, values, color});
    const average = (period: number) => rows.map((_, index) => index < period - 1 ? null : rows.slice(index - period + 1, index + 1).reduce((sum, row) => sum + row.close, 0) / period);
    if (kind === 'bollinger' || kind === 'envelope') {
        const middle = average(options.period);
        const width = middle.map((value, index) => value === null ? null : kind === 'envelope' ? value * options.percent / 100 :
            Math.sqrt(rows.slice(index - options.period + 1, index + 1).reduce((sum, row) => sum + (row.close - value) ** 2, 0) / options.period) * options.deviation);
        return [line('M', middle, '#7d9fe6'), line('U', middle.map((value, i) => value === null ? null : value + width[i]!), '#7d9fe6'),
            line('L', middle.map((value, i) => value === null ? null : value - width[i]!), '#7d9fe6')];
    }
    if (kind === 'ichimoku') {
        const midpoint = (period: number) => rows.map((_, index) => {
            if (index < period - 1) return null;
            const window = rows.slice(index - period + 1, index + 1);
            return (Math.max(...window.map(row => row.high)) + Math.min(...window.map(row => row.low))) / 2;
        });
        const conversion = midpoint(options.conversion), base = midpoint(options.base), span = midpoint(options.span);
        const forward = (values: (number | null)[]) => Array<number | null>(options.displacement).fill(null).concat(values);
        return [line('Tenkan', conversion, '#6cbce5'), line('Kijun', base, '#e99b52'),
            line('Senkou A', forward(conversion.map((value, i) => value === null || base[i] === null ? null : (value + base[i]!) / 2)), '#45b58e'),
            line('Senkou B', forward(span), '#d77992'),
            line('Chikou', rows.map((_, i) => rows[i + options.displacement]?.close ?? null), '#b591df')];
    }
    const values: (number | null)[] = rows.map(() => null);
    if (rows.length < 2) return [line('SAR', values, '#ed8d9a')];
    let rising = rows[1].close >= rows[0].close;
    let sar = rising ? rows[0].low : rows[0].high;
    let extreme = rising ? Math.max(rows[0].high, rows[1].high) : Math.min(rows[0].low, rows[1].low);
    let acceleration = options.step;
    values[1] = sar;
    for (let i = 2; i < rows.length; i++) {
        sar += acceleration * (extreme - sar);
        sar = rising ? Math.min(sar, rows[i - 1].low, rows[i - 2].low) : Math.max(sar, rows[i - 1].high, rows[i - 2].high);
        if (rising ? rows[i].low < sar : rows[i].high > sar) {
            sar = extreme;
            rising = !rising;
            extreme = rising ? rows[i].high : rows[i].low;
            acceleration = options.step;
        } else if (rising ? rows[i].high > extreme : rows[i].low < extreme) {
            extreme = rising ? rows[i].high : rows[i].low;
            acceleration = Math.min(options.maximum, acceleration + options.step);
        }
        values[i] = sar;
    }
    return [line('SAR', values, '#ed8d9a')];
}
