import {afterEach, beforeEach, expect, it, vi} from 'vitest';

beforeEach(() => {vi.resetModules(); vi.useFakeTimers();});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

it('retries only failed temporary image deletions without rejecting the editing action', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(new Response(null, {status: 204}))
        .mockResolvedValueOnce(new Response('', {status: 503}))
        .mockResolvedValueOnce(new Response(null, {status: 204}));
    vi.stubGlobal('fetch', fetcher);
    const cleanup = await import('./manuscriptImageCleanup');
    cleanup.queueManuscriptImageCleanup([{url: '/first.png', deleteToken: 'first'}, {url: '/second.png', deleteToken: 'second'}]);
    await expect(cleanup.flushManuscriptImageCleanup()).resolves.toBeUndefined();
    await vi.advanceTimersByTimeAsync(1500);
    expect(fetcher.mock.calls.map(call => call[0])).toEqual(['/first.png', '/second.png', '/second.png']);
    expect(vi.getTimerCount()).toBe(0);
});

it('bounds retries when storage stays unavailable', async () => {
    const fetcher = vi.fn().mockRejectedValue(new Error('offline'));
    vi.stubGlobal('fetch', fetcher);
    const cleanup = await import('./manuscriptImageCleanup');
    cleanup.queueManuscriptImageCleanup([{url: '/temporary.png', deleteToken: 'token'}]);
    await cleanup.flushManuscriptImageCleanup();
    await vi.advanceTimersByTimeAsync(4500);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(vi.getTimerCount()).toBe(0);
});
