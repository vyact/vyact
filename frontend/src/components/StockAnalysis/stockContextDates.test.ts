import {afterEach, beforeEach, expect, it, vi} from 'vitest';

beforeEach(() => {vi.resetModules(); vi.useFakeTimers();});
afterEach(() => {vi.useRealTimers(); vi.restoreAllMocks();});

it('reuses today’s dates across callers and refreshes on the next market day', async () => {
    vi.setSystemTime(new Date('2026-11-12T03:00:00Z'));
    const {stockAnalysis} = await import('../../services/stockAnalysis');
    const fetch = vi.spyOn(stockAnalysis, 'prices').mockResolvedValue([{day: '2026-11-12'}] as never);
    const {loadMarketContextDates} = await import('./stockContextDates');
    await Promise.all([loadMarketContextDates('KR'), loadMarketContextDates('KR')]);
    vi.advanceTimersByTime(60 * 60 * 1000);
    await loadMarketContextDates('KR');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(new Date('2026-11-13T03:00:00Z'));
    await loadMarketContextDates('KR');
    expect(fetch).toHaveBeenCalledTimes(2);
});

it('retries missing current-day bars after five minutes and does not cache failures', async () => {
    vi.setSystemTime(new Date('2026-11-13T00:00:00Z'));
    const {stockAnalysis} = await import('../../services/stockAnalysis');
    const fetch = vi.spyOn(stockAnalysis, 'prices').mockResolvedValue([{day: '2026-11-12'}] as never);
    const {loadMarketContextDates} = await import('./stockContextDates');
    await loadMarketContextDates('KR');
    await loadMarketContextDates('KR');
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(5 * 60 * 1000);
    fetch.mockRejectedValueOnce(new Error('offline'));
    await expect(loadMarketContextDates('KR')).rejects.toThrow('offline');
    await loadMarketContextDates('KR');
    expect(fetch).toHaveBeenCalledTimes(3);
});
