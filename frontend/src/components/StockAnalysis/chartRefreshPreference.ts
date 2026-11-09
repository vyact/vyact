const CHART_REFRESH_STORAGE_KEY = 'vyact:stock-analysis:chart-refresh-seconds';
export const REFRESH_INTERVALS = [10, 30, 60, 300] as const;
export const DEFAULT_REFRESH_SECONDS = 30;

export function readChartRefreshSeconds(): number {
    try {
        const seconds = Number(localStorage.getItem(CHART_REFRESH_STORAGE_KEY));
        if (REFRESH_INTERVALS.some(value => value === seconds)) return seconds;
    } catch { /* Use the default when storage is unavailable. */ }
    return DEFAULT_REFRESH_SECONDS;
}

export function saveChartRefreshSeconds(seconds: number): void {
    if (!REFRESH_INTERVALS.some(value => value === seconds)) return;
    try {localStorage.setItem(CHART_REFRESH_STORAGE_KEY, String(seconds));} catch { /* Keep the session preference. */ }
}
