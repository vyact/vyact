import {beforeEach, describe, expect, it, vi} from 'vitest';
import type {MarketSectorMap} from './stockAnalysis';

const map: MarketSectorMap = {date: '2026-11-05', quoteDate: '2026-11-06', sectors: [
    {name: 'Technology', weight: 100, change: 1, stocks: [{symbol: 'AAPL', name: 'Apple', weight: 100, price: 342.37, change: 1}]},
]};

beforeEach(() => {
    vi.resetModules();
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => storage.set(key, value)});
});

describe('stock snapshot cache', () => {
    it('restores the last market snapshot after module reload and keeps markets separate', async () => {
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        cache.writeMap('US', map);
        vi.resetModules();
        const {stockSnapshotCache: restored} = await import('./stockSnapshotCache');
        expect(restored.readMap('US')).toEqual(map);
        expect(restored.readMap('KR')).toBeUndefined();
    });
    it('normalizes legacy Korean directory and sector snapshots without losing exchange info', async () => {
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        cache.writeSymbols('KR', [{symbol: '005930.KS', name: 'Samsung'}]);
        expect(cache.readSymbols('KR')).toEqual([{symbol: '005930', name: 'Samsung', exchange: 'KOSPI'}]);
        cache.writeMap('KR', {...map, sectors: [{...map.sectors[0], stocks: [{...map.sectors[0].stocks[0], symbol: '0001A0.KQ'}]}]});
        const stock = cache.readMap('KR')?.sectors[0].stocks[0];
        expect(stock?.symbol).toBe('0001A0');
        expect(stock?.exchange).toBe('KOSDAQ');
    });
    it('retains valid indices after a partial or failed response', async () => {
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        const index = {symbol: '^GSPC', price: 100, change: 1, changePercent: 1, date: '2026-11-06', closes: [99, 100]};
        cache.writeIndices([index]);
        cache.writeIndices([{...index, symbol: '^IXIC'}]);
        cache.writeIndices([{...index, price: null}]);
        expect(cache.readIndices()?.map(item => item.symbol).sort()).toEqual(['GSPC', 'IXIC']);
    });
    it('clears old provider snapshots and prices after API settings change', async () => {
        const values: Record<string, string> = {};
        const storage = {
            getItem: (key: string) => values[key] ?? null,
            setItem(key: string, value: string) {
                values[key] = value;
                Object.defineProperty(this, key, {value, configurable: true, enumerable: true});
            },
            removeItem(key: string) {delete values[key]; Reflect.deleteProperty(this, key);},
        };
        vi.stubGlobal('localStorage', storage);
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        cache.writeMap('US', map);
        storage.setItem('vyact:stock-prices:v3', 'old prices');
        storage.setItem('vyact-theme', 'dark');
        cache.clear();
        expect(cache.readMap('US')).toBeUndefined();
        expect(storage.getItem('vyact:stock-prices:v3')).toBeNull();
        expect(storage.getItem('vyact-theme')).toBe('dark');
    });
    it('still caches in memory when browser storage is unavailable', async () => {
        vi.stubGlobal('localStorage', {getItem: () => {throw Error('blocked');}, setItem: () => {throw Error('full');}});
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        cache.writeMap('US', map);
        expect(cache.readMap('US')).toEqual(map);
    });
});
