import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import useMarketOpeningRefresh from './useMarketOpeningRefresh';

const state = vi.hoisted(() => ({cleanups: [] as (() => void)[], update: vi.fn()}));
vi.mock('react', () => ({
    useState: () => [0, state.update],
    useRef: (value: unknown) => ({current: value}),
    useEffect: (effect: () => (() => void) | undefined) => {
        const cleanup = effect();
        if (cleanup) state.cleanups.push(cleanup);
    },
}));
beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-10T14:29:45Z'));
    vi.stubGlobal('window', Object.assign(new EventTarget(), {setTimeout, clearTimeout}));
    vi.stubGlobal('document', new EventTarget());
    state.update.mockClear();
});
afterEach(() => {
    state.cleanups.splice(0).forEach(cleanup => cleanup());
    vi.unstubAllGlobals();
    vi.useRealTimers();
});
it('refreshes exactly at opening independently of polling and only once', () => {
    useMarketOpeningRefresh(Date.parse('2026-11-10T14:30:00Z') / 1000, 'US');
    vi.advanceTimersByTime(14_999);
    expect(state.update).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(state.update).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event('focus'));
    expect(state.update).toHaveBeenCalledTimes(1);
});
it('catches a missed opening when the app wakes', () => {
    useMarketOpeningRefresh(Date.parse('2026-11-10T14:30:00Z') / 1000, 'US');
    vi.setSystemTime(new Date('2026-11-10T14:31:00Z'));
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new Event('focus'));
    expect(state.update).toHaveBeenCalledTimes(1);
});
it('cancels the timer on cleanup', () => {
    useMarketOpeningRefresh(Date.parse('2026-11-10T14:30:00Z') / 1000, 'US');
    state.cleanups.splice(0).forEach(cleanup => cleanup());
    vi.advanceTimersByTime(30_000);
    expect(state.update).not.toHaveBeenCalled();
});
