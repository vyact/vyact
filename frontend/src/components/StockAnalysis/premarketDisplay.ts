export function formatPremarketQuoteDate(value: string, language?: string): string {
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return new Intl.DateTimeFormat(language, {
        month: 'short', day: 'numeric',
        timeZone: 'America/New_York',
    }).format(date);
}
