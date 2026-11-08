import type {FinancialPeriod, FinancialFrequency} from '../services/stockFinancials';

const KOREAN_AMOUNT_DIVISOR = 100_000_000;
export function formatFinancialAmount(value: number, metric: string, language: string, koreanUnit: string): string {
    if (metric === 'eps') return new Intl.NumberFormat(language, {maximumFractionDigits: 2}).format(value);
    if (language.split('-')[0] === 'ko') return `${new Intl.NumberFormat(language, {maximumFractionDigits: 1}).format(value / KOREAN_AMOUNT_DIVISOR)}${koreanUnit}`;
    return new Intl.NumberFormat(language, {notation: 'compact', maximumFractionDigits: 1}).format(value);
}

function quarterIndex(period: string): number {
    const [year, month] = period.split('-').map(Number);
    return year * 4 + Math.floor((month - 1) / 3);
}
export function financialChange(periods: FinancialPeriod[], current: FinancialPeriod, metric: string, comparison: 'qoq' | 'yoy', frequency: FinancialFrequency): number | null {
    if (comparison === 'qoq' && frequency === 'yearly') return null;
    const distance = comparison === 'qoq' ? 1 : 4;
    const previous = periods.find(item => quarterIndex(item.period) === quarterIndex(current.period) - distance);
    const value = current.values[metric];
    const baseline = previous?.values[metric];
    if (value == null || baseline == null || baseline === 0) return null;
    const change = (value - baseline) / Math.abs(baseline) * 100;
    return Number.isFinite(change) ? change : null;
}
