import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {stockAnalysis} from '../../services/stockAnalysis';
import useStockPriceRefresh from './useStockPriceRefresh';

const effects = vi.hoisted(() => [] as (() => void)[]);
vi.mock('react', () => ({
    useRef: (value: unknown) => ({current: value}),
    useEffect: (effect: () => (() => void) | undefined) => {const cleanup = effect(); if (cleanup) effects.push(cleanup);},
}));

beforeEach(() => {
    vi.useFakeTimers();
    vi.stubGlobal('window', globalThis);
    vi.stubGlobal('document', {visibilityState: 'visible'});
});
afterEach(() => {
    effects.splice(0).forEach(cleanup => cleanup());
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

describe('per-symbol chart refresh', () => {
    it('refreshes US while Korean comparison is closed, then captures US close once', async () => {
        let usOpen = true;
        vi.spyOn(stockAnalysis, 'tradingStatus').mockImplementation(async symbol => ({open: symbol === 'AAPL' && usOpen}));
        const prices = vi.spyOn(stockAnalysis, 'prices').mockResolvedValue([
            {day: '2026-11-09', open: 100, high: 110, low: 90, close: 105, volume: 1000},
        ]);
        const receive = vi.fn();
        useStockPriceRefresh('AAPL', 30, true, receive);
        useStockPriceRefresh('005930', 30, true, receive);
        await vi.advanceTimersByTimeAsync(30000);
        expect(prices).toHaveBeenCalledTimes(1);
        expect(prices.mock.calls[0][0]).toBe('AAPL');
        usOpen = false;
        await vi.advanceTimersByTimeAsync(30000);
        expect(prices).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(60000);
        expect(prices).toHaveBeenCalledTimes(2);
        expect(receive).toHaveBeenCalledTimes(2);
    });

    it('does not request prices when the chart is inactive or hidden', async () => {
        const status = vi.spyOn(stockAnalysis, 'tradingStatus').mockResolvedValue({open: true});
        useStockPriceRefresh('AAPL', 10, false, vi.fn());
        vi.stubGlobal('document', {visibilityState: 'hidden'});
        useStockPriceRefresh('005930', 10, true, vi.fn());
        await vi.advanceTimersByTimeAsync(30000);
        expect(status).not.toHaveBeenCalled();
    });
});
