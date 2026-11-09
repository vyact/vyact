import {afterEach, describe, expect, it, vi} from 'vitest';
import {stockAnalysis} from './stockAnalysis';

afterEach(() => vi.unstubAllGlobals());

describe('chart price freshness', () => {
    it.each(['AAPL', '005930', '7203.T', 'IXIC', 'KS11', 'N225', 'NQ=F'])(
        'requests current prices for %s on every chart load', async symbol => {
            const cached = [{symbol, fetchedAt: Date.now(), rows: [{day: '2026-11-06', close: 100}]}];
            vi.stubGlobal('localStorage', {getItem: () => JSON.stringify(cached)});
            const latest = [{day: '2026-11-09', open: 100, high: 110, low: 95, close: 105, volume: 1000}];
            const fetch = vi.fn(async () => new Response(JSON.stringify(latest), {status: 200}));
            vi.stubGlobal('fetch', fetch);
            const signal = new AbortController().signal;

            expect(await stockAnalysis.prices(symbol, signal)).toEqual(latest);
            expect(await stockAnalysis.prices(symbol, signal)).toEqual(latest);
            expect(fetch).toHaveBeenCalledTimes(2);
            expect(fetch).toHaveBeenLastCalledWith(`/api/stock-analysis/prices/${encodeURIComponent(symbol)}`,
                {signal, cache: 'no-store'});
        },
    );
});
