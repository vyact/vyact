import {afterEach, describe, expect, it, vi} from 'vitest';
import {isMarketIndexSymbol, normalizeStockSymbol, stockSymbolCode, stockWatchlistKey} from './stockSymbols';
import {stockAnalysis} from '../services/stockAnalysis';

afterEach(() => vi.unstubAllGlobals());

describe('provider-independent stock codes', () => {
    it('removes only Korean provider suffixes and retains exchange badges', () => {
        expect(normalizeStockSymbol({symbol: '005930.KS', name: 'Samsung'})).toEqual({symbol: '005930', name: 'Samsung', exchange: 'KOSPI'});
        expect(normalizeStockSymbol({symbol: '0001A0.KQ', name: 'Stock'})).toEqual({symbol: '0001A0', name: 'Stock', exchange: 'KOSDAQ'});
        for (const symbol of ['BRK.B', 'AAPL', 'KS11', 'GSPC', '005930']) expect(stockSymbolCode(symbol)).toBe(symbol);
    });
    it('removes Yahoo index prefixes from API identities', () => {
        expect(stockSymbolCode('^KS11')).toBe('KS11');
        expect(stockSymbolCode('^GSPC')).toBe('GSPC');
    });
    it('maps legacy watchlist entries to the same canonical identity', () => {
        expect(stockWatchlistKey('KR', '005930.KS')).toBe(stockWatchlistKey('KR', '005930'));
        expect(stockWatchlistKey('KR', '0001A0.KQ')).toBe('KR:0001A0');
        expect(stockWatchlistKey('US', 'BRK.B')).toBe('US:BRK.B');
    });
    it('sends canonical codes for prices, sparklines and memo requests', async () => {
        vi.stubGlobal('localStorage', {getItem: () => null, setItem: () => undefined});
        const fetch = vi.fn(async () => new Response('[]', {status: 200}));
        vi.stubGlobal('fetch', fetch);
        const signal = new AbortController().signal;
        await stockAnalysis.prices('005930.KS', signal);
        await stockAnalysis.sparkline('0001A0.KQ', signal);
        await stockAnalysis.memos('005930.KS', signal);
        expect(fetch.mock.calls.map(call => (call as unknown[])[0])).toEqual([
            '/api/stock-analysis/prices/005930', '/api/stock-analysis/sparkline/0001A0', '/api/stock-analysis/memos/005930',
        ]);
    });
});

it('recognizes Asian indices without treating mainland stock symbols as indices', () => {
    for (const symbol of ['TWII', '^TWII', 'HSI', '^HSI', '000001.SS', '399001.SZ']) {
        expect(isMarketIndexSymbol(symbol)).toBe(true);
    }
    for (const symbol of ['2330.TW', '3293.TWO', '0700.HK', '600519.SS', '300750.SZ']) {
        expect(isMarketIndexSymbol(symbol)).toBe(false);
        expect(stockSymbolCode(symbol)).toBe(symbol);
    }
});
