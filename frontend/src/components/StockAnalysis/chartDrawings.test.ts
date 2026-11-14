import {afterEach, expect, it, vi} from 'vitest';
import type {IChartApi, ISeriesApi} from 'lightweight-charts';
import type {DailyPrice} from '../../services/stockAnalysis';
import {attachChartDrawings} from './chartDrawings';
afterEach(() => vi.unstubAllGlobals());
it('keeps drawings temporary and supports undo', () => {
    const storage = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value)});
    vi.stubGlobal('getComputedStyle', () => ({getPropertyValue: () => '#60a5fa'}));
    vi.stubGlobal('window', {addEventListener: vi.fn(), removeEventListener: vi.fn()});
    const listeners = new Map<string, (event: {clientX: number; clientY: number}) => void>();
    const element = {addEventListener: (name: string, callback: (event: {clientX: number; clientY: number}) => void) => listeners.set(name, callback),
        removeEventListener: vi.fn(), getBoundingClientRect: () => ({left: 0, top: 0})};
    const chart = {chartElement: () => element, addSeries: () => ({setData: vi.fn()}), removeSeries: vi.fn(),
        paneSize: () => ({width: 100, height: 100}), timeScale: () => ({coordinateToTime: () => '2026-11-02'}),
        subscribeCrosshairMove: vi.fn(), unsubscribeCrosshairMove: vi.fn()};
    const candles = {coordinateToPrice: (y: number) => y * 10, createPriceLine: vi.fn(() => ({})), removePriceLine: vi.fn()};
    const rows = [{day: '2026-11-02', close: 100, open: 100, high: 110, low: 90, volume: null}] as DailyPrice[];
    const attach = () => attachChartDrawings(chart as unknown as IChartApi, candles as unknown as ISeriesApi<'Candlestick'>, rows);
    const drawing = attach(); drawing.setMode('horizontal');
    listeners.get('pointerdown')?.({clientX: 0, clientY: 25}); listeners.get('click')?.({clientX: 0, clientY: 25});
    expect(candles.createPriceLine).toHaveBeenLastCalledWith(expect.objectContaining({price: 250}));
    drawing.undo(); expect(candles.removePriceLine).toHaveBeenCalled();
    drawing.dispose(); attach();
    expect(candles.createPriceLine).toHaveBeenCalledTimes(1);
    expect(storage.size).toBe(0);
});
