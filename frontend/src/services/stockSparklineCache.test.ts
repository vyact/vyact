import {beforeEach, describe, expect, it, vi} from 'vitest';

const {request} = vi.hoisted(() => ({request: vi.fn()}));
vi.mock('./stockAnalysis', () => ({stockAnalysis: {sparklines: request}}));
let saved: Map<string, string>;
const day = '2026-11-09';
const closes = Array.from({length: 20}, (_, index) => index + 100);
const response = (symbols: string[]) => Object.fromEntries(symbols.map(symbol => [symbol, closes]));

beforeEach(() => {
    vi.resetModules();
    request.mockReset();
    saved = new Map();
    vi.stubGlobal('localStorage', {getItem: (key: string) => saved.get(key) ?? null, setItem: (key: string, value: string) => saved.set(key, value)});
});

describe('preloaded sector mini charts', () => {
    it('shares pending preloads with hover requests and saves them for the next page load', async () => {
        let finish!: (value: Record<string, number[]>) => void;
        request.mockImplementation(() => new Promise(resolve => {finish = resolve;}));
        const cache = await import('./stockSparklineCache');
        cache.preloadSectorSparklines(['AAPL', 'NVDA'], day);
        cache.preloadSectorSparklines(['NVDA', 'AAPL'], day, true);
        expect(request).toHaveBeenCalledTimes(1);
        finish(response(['AAPL', 'NVDA']));
        await vi.waitFor(() => expect(cache.readSectorSparklines(day).NVDA).toEqual(closes));
        vi.resetModules();
        request.mockClear();
        const reloaded = await import('./stockSparklineCache');
        reloaded.preloadSectorSparklines(['AAPL', 'NVDA'], day);
        expect(reloaded.readSectorSparklines(day).NVDA).toEqual(closes);
        expect(request).not.toHaveBeenCalled();
    });
    it('limits background concurrency and promotes hovered stocks ahead of queued preloads', async () => {
        let first!: (value: Record<string, number[]>) => void;
        let second!: (value: Record<string, number[]>) => void;
        request.mockImplementation(async (symbols: string[]) => response(symbols))
            .mockImplementationOnce(() => new Promise(resolve => {first = resolve;}))
            .mockImplementationOnce(() => new Promise(resolve => {second = resolve;}));
        const cache = await import('./stockSparklineCache');
        cache.preloadSectorSparklines(Array.from({length: 100}, (_, index) => `S${index}`), day);
        expect(request).toHaveBeenCalledTimes(2);
        expect(request.mock.calls.every(call => call[0].length <= 20)).toBe(true);
        cache.preloadSectorSparklines(['S99', 'HOVER'], day, true);
        first(response(request.mock.calls[0][0]));
        await vi.waitFor(() => expect(cache.readSectorSparklines(day).HOVER).toEqual(closes));
        expect(request.mock.calls[2][0].slice(0, 2)).toEqual(['S99', 'HOVER']);
        second(response(request.mock.calls[1][0]));
        await vi.waitFor(() => expect(cache.readSectorSparklines(day).S20).toEqual(closes));
    });
    it('keeps the latest 20 valid prices and fetches again for a new trading day', async () => {
        request.mockResolvedValue({AAPL: [0, ...Array.from({length: 30}, (_, index) => index + 1), Number.NaN]});
        const cache = await import('./stockSparklineCache');
        cache.preloadSectorSparklines(['AAPL'], day);
        await vi.waitFor(() => expect(cache.readSectorSparklines(day).AAPL).toHaveLength(20));
        expect(cache.readSectorSparklines(day).AAPL).toEqual(Array.from({length: 20}, (_, index) => index + 11));
        cache.preloadSectorSparklines(['AAPL'], '2026-11-10');
        await vi.waitFor(() => expect(cache.readSectorSparklines('2026-11-10').AAPL).toHaveLength(20));
        expect(request).toHaveBeenCalledTimes(2);
    });
});
