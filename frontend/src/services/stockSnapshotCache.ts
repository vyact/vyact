import type {MarketIndex, MarketSectorMap, StockMarket, StockSymbol} from './stockAnalysis';
import {normalizeStockSectorMap, normalizeStockSymbol} from '../utils/stockSymbols';
import {localizeStockName} from '../utils/stockDisplayName';

type CachedSnapshot<T> = {savedAt: number; data: T};
const CACHE_PREFIX = 'vyact:stock-snapshot:v1:';
const MAX_CACHE_AGE_MS = 7 * 24 * 60 * 60 * 1000;
const memory = new Map<string, CachedSnapshot<unknown>>();

function symbolSnapshotKey(market: StockMarket, language: string): string {
    const localizedChinese = ['TW', 'HK', 'CN'].includes(market) && language.toLowerCase().startsWith('zh');
    return `symbols:${market}:${language}${localizedChinese ? ':names-v2' : ''}`;
}

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
    symbolsFetchedAt: (market: StockMarket, language = 'en') => {
        readSnapshot<StockSymbol[]>(symbolSnapshotKey(market, language), (value): value is StockSymbol[] => Array.isArray(value));
        return memory.get(symbolSnapshotKey(market, language))?.savedAt ?? 0;
    },
    clear: () => {
        memory.clear();
        try {
            const keys = Object.keys(localStorage).filter(key => key.startsWith(CACHE_PREFIX) || key.startsWith('vyact:stock-prices:'));
            keys.forEach(key => localStorage.removeItem(key));
        } catch { /* In-memory snapshots have still been invalidated. */ }
    },
    readSymbols: (market: StockMarket, language = 'en') => readSnapshot<StockSymbol[]>(symbolSnapshotKey(market, language),
        (data): data is StockSymbol[] => Array.isArray(data) && data.length > 0
            && data.every(item => typeof item?.symbol === 'string' && typeof item.name === 'string'))
        ?.map(item => ({...normalizeStockSymbol(item), name: localizeStockName(item.name, language)})),
    writeSymbols: (market: StockMarket, symbols: StockSymbol[], language = 'en') => writeSnapshot(symbolSnapshotKey(market, language), symbols),
    readMap: (market: StockMarket, language = 'en') => {
        const snapshot = readSnapshot<MarketSectorMap>(`map-v2:${market}:${language}`, (value): value is MarketSectorMap => {
            const map = value as MarketSectorMap | null;
            return Boolean(map && typeof map.date === 'string' && typeof map.quoteDate === 'string'
                && Array.isArray(map.sectors) && map.sectors.length
                && map.sectors.every(sector => typeof sector.name === 'string' && Array.isArray(sector.stocks)));
        });
        return snapshot ? normalizeStockSectorMap(snapshot) : undefined;
    },
    writeMap: (market: StockMarket, snapshot: MarketSectorMap, language = 'en') => writeSnapshot(`map-v2:${market}:${language}`, snapshot),
    readIndices: () => readSnapshot<MarketIndex[]>('indices', (value): value is MarketIndex[] =>
        Array.isArray(value) && value.length > 0 && value.every(index => typeof index?.symbol === 'string'
            && Array.isArray(index.closes) && typeof index.price === 'number'))?.map(normalizeStockSymbol),
    writeIndices: (indices: MarketIndex[]) => {
        const valid = indices.map(normalizeStockSymbol).filter(index => index.price != null);
        if (valid.length) {
            const previous = stockSnapshotCache.readIndices() ?? [];
            writeSnapshot('indices', [...valid, ...previous.filter(index => !valid.some(item => item.symbol === index.symbol))]);
        }
    },
};
