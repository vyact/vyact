export type StockContextRange = {start: string; end: string} | null;

function isDate(value: unknown): value is string {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
        && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
}

export function normalizeContextRange(value: unknown): StockContextRange {
    if (!value || typeof value !== 'object' || !('start' in value) || !('end' in value)) return null;
    return isDate(value.start) && isDate(value.end) && value.start <= value.end ? {start: value.start, end: value.end} : null;
}

export function clampContextRange(range: StockContextRange, min?: string, max?: string): StockContextRange {
    if (!range || !min || !max) return range;
    const clamp = (day: string) => day < min ? min : day > max ? max : day;
    return {start: clamp(range.start), end: clamp(range.end)};
}
