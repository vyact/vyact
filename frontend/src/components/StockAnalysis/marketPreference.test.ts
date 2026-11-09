import {beforeEach, expect, it, vi} from 'vitest';

beforeEach(() => {
    vi.resetModules();
    const data = new Map<string, string>();
    vi.stubGlobal('localStorage', {getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => data.set(key, value)});
});

it('defaults Korean users to Korea without a saved selection', async () => {
    const {getInitialMarket} = await import('./marketPreference');
    expect(getInitialMarket('ko-KR')).toBe('KR');
    expect(getInitialMarket('en')).toBe('US');
});
it('restores the selected market before the language default when reopened', async () => {
    const {saveMarketPreference} = await import('./marketPreference');
    saveMarketPreference('US');
    vi.resetModules();
    const restored = await import('./marketPreference');
    expect(restored.getInitialMarket('ko')).toBe('US');
    restored.saveMarketPreference('KR');
    expect(restored.getInitialMarket('en')).toBe('KR');
});
it('keeps the selection during the session when storage is blocked', async () => {
    vi.stubGlobal('localStorage', {getItem: () => {throw Error('blocked');}, setItem: () => {throw Error('blocked');}});
    const {getInitialMarket, saveMarketPreference} = await import('./marketPreference');
    expect(getInitialMarket('ko')).toBe('KR');
    saveMarketPreference('US');
    expect(getInitialMarket('ko')).toBe('US');
});

it('defaults Japanese users to Japan and restores their saved market', async () => {
    const {getInitialMarket, saveMarketPreference} = await import('./marketPreference');
    expect(getInitialMarket('ja-JP')).toBe('JP');
    saveMarketPreference('JP');
    vi.resetModules();
    const restored = await import('./marketPreference');
    expect(restored.getInitialMarket('en')).toBe('JP');
});
