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
    it('retains valid indices after a partial or failed response', async () => {
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        const index = {symbol: '^GSPC', price: 100, change: 1, changePercent: 1, date: '2026-11-06', closes: [99, 100]};
        cache.writeIndices([index]);
        cache.writeIndices([{...index, symbol: '^IXIC'}]);
        cache.writeIndices([{...index, price: null}]);
        expect(cache.readIndices()?.map(item => item.symbol).sort()).toEqual(['^GSPC', '^IXIC']);
    });
    it('still caches in memory when browser storage is unavailable', async () => {
        vi.stubGlobal('localStorage', {getItem: () => {throw Error('blocked');}, setItem: () => {throw Error('full');}});
        const {stockSnapshotCache: cache} = await import('./stockSnapshotCache');
        cache.writeMap('US', map);
        expect(cache.readMap('US')).toEqual(map);
    });
});
