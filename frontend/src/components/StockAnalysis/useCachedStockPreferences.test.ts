import {afterEach, beforeEach, expect, it, vi} from 'vitest';
import useCachedStockPreferences from './useCachedStockPreferences';

const hooks = vi.hoisted(() => ({slots: [] as unknown[], cursor: 0, effects: [] as (() => void)[], dirty: false}));
vi.mock('react', () => ({
    useState: (initial: unknown) => {
        const index = hooks.cursor++;
        if (!(index in hooks.slots)) hooks.slots[index] = typeof initial === 'function' ? initial() : initial;
        return [hooks.slots[index], (value: unknown) => {
            hooks.slots[index] = typeof value === 'function' ? value(hooks.slots[index]) : value;
            hooks.dirty = true;
        }];
    },
    useRef: (initial: unknown) => {
        const index = hooks.cursor++;
        if (!(index in hooks.slots)) hooks.slots[index] = {current: initial};
        return hooks.slots[index];
    },
    useEffect: (effect: () => void, deps: unknown[]) => {
        const index = hooks.cursor++;
        const previous = hooks.slots[index] as unknown[] | undefined;
        if (!previous || deps.some((value, i) => value !== previous[i])) hooks.effects.push(effect);
        hooks.slots[index] = deps;
    },
}));
const normalize = (value: unknown) => Array.isArray(value) ? value as string[] : [];
const fetchMock = vi.fn();
let result: ReturnType<typeof useCachedStockPreferences<string>>;
function render() {
    hooks.cursor = 0;
    hooks.dirty = false;
    result = useCachedStockPreferences('watchlist', 'cache', normalize);
    hooks.effects.splice(0).forEach(effect => effect());
}
async function settle() {
    for (let i = 0; i < 20; i++) {await Promise.resolve(); if (hooks.dirty) render();}
}
const ok = (items: string[] | null) => ({ok: true, json: async () => ({items})});
beforeEach(() => {
    hooks.slots = []; hooks.effects = []; hooks.dirty = false;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {getItem: () => '["cached"]', setItem: vi.fn()});
});
afterEach(() => vi.unstubAllGlobals());

it('replaces cache with ES data without writing stale cache back', async () => {
    fetchMock.mockResolvedValue(ok(['remote']));
    render(); await settle();
    expect(result.items).toEqual(['remote']);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('migrates local data only when the ES document is missing', async () => {
    fetchMock.mockResolvedValueOnce(ok(null)).mockResolvedValue(ok([]));
    render(); await settle();
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({items: ['cached']});
});
it('keeps an explicitly empty ES list empty', async () => {
    fetchMock.mockResolvedValue(ok([]));
    render(); await settle();
    expect(result.items).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
});
it('replays edits made during loading against the ES snapshot', async () => {
    let resolve!: (response: ReturnType<typeof ok>) => void;
    fetchMock.mockReturnValueOnce(new Promise(done => {resolve = done;})).mockResolvedValue(ok([]));
    render(); result.setItems(items => [...items, 'added']); render();
    resolve(ok(['remote'])); await settle();
    expect(result.items).toEqual(['remote', 'added']);
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).items).toEqual(['remote', 'added']);
});
it('does not overwrite ES on a read failure and allows retry', async () => {
    fetchMock.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok(['remote']));
    render(); await settle();
    expect(result.failed).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    result.retry(); render(); await settle();
    expect(result.items).toEqual(['remote']);
    expect(result.failed).toBe(false);
});
it('serializes edits and retries a failed write with the latest state', async () => {
    let resolve!: (response: ReturnType<typeof ok>) => void;
    fetchMock.mockResolvedValueOnce(ok([]))
        .mockReturnValueOnce(new Promise(done => {resolve = done;}))
        .mockRejectedValueOnce(new Error('offline')).mockResolvedValue(ok([]));
    render(); await settle();
    result.setItems(['one']); render(); await settle();
    result.setItems(['one', 'two']); render(); await settle();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    resolve(ok([])); await settle();
    expect(result.failed).toBe(true);
    result.retry(); render(); await settle();
    expect(JSON.parse(fetchMock.mock.calls[3][1].body).items).toEqual(['one', 'two']);
    expect(result.failed).toBe(false);
});
