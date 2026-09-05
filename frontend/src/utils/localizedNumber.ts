import i18n from 'i18next';

export function formatLocalizedNumber(value: number, fractionDigits: number): string {
    return new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language || 'en', {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
        useGrouping: false,
    }).format(value);
}
