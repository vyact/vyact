import type {MarketIndex, MarketSectorMap, StockMarket} from './stockAnalysis';

type CachedSnapshot<T> = {savedAt: number; data: T};
const CACHE_PREFIX = 'vyact:stock-snapshot:v1:';
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const memory = new Map<string, CachedSnapshot<unknown>>();

function readSnapshot<T>(key: string, validate: (data: unknown) => data is T): T | undefined {
    try {
        const entry = memory.get(key) ?? JSON.parse(localStorage.getItem(CACHE_PREFIX + key) ?? 'null');
        if (!entry || typeof entry.savedAt !== 'number' || entry.savedAt > Date.now()
            || Date.now() - entry.savedAt > MAX_CACHE_AGE_MS || !validate(entry.data)) return;
        memory.set(key, entry);
        return entry.data;
    } catch {
        return;
    }
}

function writeSnapshot<T>(key: string, data: T) {
    const entry = {savedAt: Date.now(), data};
    memory.set(key, entry);
    try {localStorage.setItem(CACHE_PREFIX + key, JSON.stringify(entry));} catch { /* Memory caching remains available. */ }
}

export const stockSnapshotCache = {
    readMap: (market: StockMarket, language = 'en') => readSnapshot<MarketSectorMap>(`${market}:${language}`, (value): value is MarketSectorMap => {
        const map = value as MarketSectorMap | null;
        return Boolean(map && typeof map.date === 'string' && typeof map.quoteDate === 'string'
            && Array.isArray(map.sectors) && map.sectors.length
            && map.sectors.every(sector => typeof sector.name === 'string' && Array.isArray(sector.stocks)));
    }),
    writeMap: (market: StockMarket, snapshot: MarketSectorMap, language = 'en') => writeSnapshot(`${market}:${language}`, snapshot),
    readIndices: () => readSnapshot<MarketIndex[]>('indices', (value): value is MarketIndex[] =>
        Array.isArray(value) && value.length > 0 && value.every(index => typeof index?.symbol === 'string'
            && Array.isArray(index.closes) && typeof index.price === 'number')),
    writeIndices: (indices: MarketIndex[]) => {
        const valid = indices.filter(index => index.price != null);
        if (valid.length) {
            const previous = stockSnapshotCache.readIndices() ?? [];
            writeSnapshot('indices', [...valid, ...previous.filter(index => !valid.some(item => item.symbol === index.symbol))]);
        }
    },
};
