type UnitRule = {divisor: number; key: string};
type NumberConvention = {minimum: number; units: UnitRule[]};
const KOREAN_UNITS: UnitRule[] = [{divisor: 1e12, key: 'trillion'}, {divisor: 1e8, key: 'hundredMillion'}, {divisor: 1e6, key: 'million'}];
const EAST_ASIAN_UNITS: UnitRule[] = [{divisor: 1e12, key: 'trillion'}, {divisor: 1e8, key: 'hundredMillion'}, {divisor: 1e4, key: 'tenThousand'}];
const INTERNATIONAL_UNITS: UnitRule[] = [{divisor: 1e12, key: 'trillion'}, {divisor: 1e9, key: 'billion'}, {divisor: 1e6, key: 'million'}, {divisor: 1e3, key: 'thousand'}];

// Korean daily prices retain Vyvow's million threshold. Other languages use
// their own first unit, rather than inheriting the Korean display threshold.
const CONVENTIONS: Record<string, NumberConvention> = {
    ko: {minimum: 1e6, units: KOREAN_UNITS},
    ja: {minimum: 1e4, units: EAST_ASIAN_UNITS},
    zh: {minimum: 1e4, units: EAST_ASIAN_UNITS},
    en: {minimum: 1e3, units: INTERNATIONAL_UNITS},
    fr: {minimum: 1e3, units: INTERNATIONAL_UNITS},
    es: {minimum: 1e3, units: INTERNATIONAL_UNITS},
    th: {minimum: 1e3, units: INTERNATIONAL_UNITS},
    vi: {minimum: 1e3, units: INTERNATIONAL_UNITS},
};

export function formatHistoryQuantity(value: number, language: string, unitLabel: (key: string) => string): string {
    const locale = language.toLowerCase().split(/[-_]/)[0];
    const convention = CONVENTIONS[locale] ?? CONVENTIONS.en;
    const numberLocale = language.replaceAll('_', '-');
    if (Math.abs(value) < convention.minimum) return value.toLocaleString(numberLocale);
    const unit = convention.units.find(item => Math.abs(value) >= item.divisor);
    if (!unit) return value.toLocaleString(numberLocale);
    const scaled = value / unit.divisor;
    const digits = Number.isInteger(scaled) ? 0 : 2;
    return `${scaled.toLocaleString(numberLocale, {minimumFractionDigits: digits, maximumFractionDigits: digits})}${unitLabel(unit.key)}`;
}
