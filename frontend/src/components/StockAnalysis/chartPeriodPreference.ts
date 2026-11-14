export const CHART_PERIODS = [1, 3, 6, 12, 0] as const;
export type ChartPeriod = typeof CHART_PERIODS[number];
const STORAGE_KEY = 'vyact:stock-analysis:chart-period';
const CHANGE_EVENT = 'vyact:stock-analysis:chart-period-change';
let sessionPeriod: ChartPeriod | undefined;

export function readChartPeriod(): ChartPeriod {
    if (sessionPeriod !== undefined) return sessionPeriod;
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        const value = stored === null ? 12 : Number(stored);
        if (CHART_PERIODS.includes(value as ChartPeriod)) return value as ChartPeriod;
    } catch { /* Use the default when storage is unavailable. */ }
    return 12;
}

export function saveChartPeriod(period: ChartPeriod) {
    sessionPeriod = period;
    try {localStorage.setItem(STORAGE_KEY, String(period));} catch { /* Keep the selection for this session. */ }
    window.dispatchEvent(new Event(CHANGE_EVENT));
}

export function subscribeChartPeriod(onChange: () => void) {
    const onStorage = (event: StorageEvent) => {
        if (event.key === STORAGE_KEY || event.key === null) {sessionPeriod = undefined; onChange();}
    };
    window.addEventListener(CHANGE_EVENT, onChange);
    window.addEventListener('storage', onStorage);
    return () => {
        window.removeEventListener(CHANGE_EVENT, onChange);
        window.removeEventListener('storage', onStorage);
    };
}
