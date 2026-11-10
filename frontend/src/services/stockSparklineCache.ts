import {stockAnalysis} from './stockAnalysis';

export const SPARKLINE_TRADING_DAYS = 20;
const BATCH_SIZE = 20;
const MAX_REQUESTS = 2;
const RETRY_MS = 60_000;
const CACHE_KEY = 'vyact:sector-sparklines:v1';
const MAX_CACHED_DAYS = 2;
type Histories = Record<string, number[]>;
const snapshots = new Map<string, Histories>();
const listeners = new Set<() => void>();
const pending = new Set<string>();
const retryAfter = new Map<string, number>();
const queue: {symbol: string; day: string}[] = [];
let active = 0;
let loaded = false;

function validCloses(values: unknown): number[] {
    return Array.isArray(values) ? values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value) && value > 0).slice(-SPARKLINE_TRADING_DAYS) : [];
}

function load() {
    if (loaded) return;
    loaded = true;
    try {
        const saved = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}');
        for (const [day, entries] of Object.entries(saved)) {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !entries || typeof entries !== 'object') continue;
            snapshots.set(day, Object.fromEntries(Object.entries(entries).flatMap(([symbol, value]) => {
                const closes = validCloses(value);
                return closes.length >= 2 ? [[symbol, closes]] : [];
            })));
        }
    } catch { /* Start with an empty in-memory cache. */ }
}

function persist() {
    try {
        const days = [...snapshots.keys()].filter(day => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort().slice(-MAX_CACHED_DAYS);
        localStorage.setItem(CACHE_KEY, JSON.stringify(Object.fromEntries(days.map(day => [day,
            Object.fromEntries(Object.entries(snapshots.get(day)!).filter(([, closes]) => closes.length >= 2)),
        ]))));
    } catch { /* In-memory data remains available when storage is full. */ }
}

export function readSectorSparklines(day: string): Histories {
    load();
    if (!snapshots.has(day)) snapshots.set(day, {});
    return snapshots.get(day)!;
}

export function subscribeSectorSparklines(listener: () => void) {
    listeners.add(listener);
    return () => {listeners.delete(listener);};
}

async function runBatch(batch: {symbol: string; day: string}[]) {
    active++;
    const day = batch[0].day;
    try {
        const result = await stockAnalysis.sparklines(batch.map(item => item.symbol), new AbortController().signal);
        const updates: Histories = {};
        for (const {symbol} of batch) {
            const closes = validCloses(result[symbol]);
            updates[symbol] = closes;
            if (closes.length < 2) retryAfter.set(`${day}:${symbol}`, Date.now() + RETRY_MS);
        }
        snapshots.set(day, {...readSectorSparklines(day), ...updates});
        persist();
        listeners.forEach(listener => listener());
    } catch {
        batch.forEach(({symbol}) => retryAfter.set(`${day}:${symbol}`, Date.now() + RETRY_MS));
        snapshots.set(day, {...readSectorSparklines(day), ...Object.fromEntries(batch.map(({symbol}) => [symbol, []]))});
        listeners.forEach(listener => listener());
    } finally {
        batch.forEach(({symbol}) => pending.delete(`${day}:${symbol}`));
        active--;
        drain();
    }
}

function drain() {
    while (active < MAX_REQUESTS && queue.length) {
        const day = queue[0].day;
        const batch = [];
        for (let index = 0; index < queue.length && batch.length < BATCH_SIZE;) {
            if (queue[index].day === day) batch.push(...queue.splice(index, 1));
            else index++;
        }
        void runBatch(batch);
    }
}

export function preloadSectorSparklines(symbols: string[], day: string, priority = false) {
    const cached = readSectorSparklines(day);
    const requested = [...new Set(symbols)];
    for (const symbol of priority ? requested.reverse() : requested) {
        const key = `${day}:${symbol}`;
        if (cached[symbol]?.length >= 2 || (retryAfter.get(key) ?? 0) > Date.now()) continue;
        if (pending.has(key)) {
            const index = priority ? queue.findIndex(item => item.day === day && item.symbol === symbol) : -1;
            if (index >= 0) queue.unshift(...queue.splice(index, 1));
            continue;
        }
        pending.add(key);
        if (priority) queue.unshift({symbol, day});
        else queue.push({symbol, day});
    }
    drain();
}
