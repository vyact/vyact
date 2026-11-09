import {afterEach, describe, expect, it, vi} from 'vitest';
import {readChartRefreshSeconds, saveChartRefreshSeconds} from './chartRefreshPreference';

afterEach(() => vi.unstubAllGlobals());

describe('chart refresh preference', () => {
    it('restores the chart preference across chart and workspace changes', () => {
        const storage = new Map<string, string>();
        vi.stubGlobal('localStorage', {
            getItem: (key: string) => storage.get(key) ?? null,
            setItem: (key: string, value: string) => storage.set(key, value),
        });
        expect(readChartRefreshSeconds()).toBe(30);
        saveChartRefreshSeconds(60);
        expect(readChartRefreshSeconds()).toBe(60);
        expect([...storage.keys()]).toEqual(['vyact:stock-analysis:chart-refresh-seconds']);
        saveChartRefreshSeconds(0);
        expect(readChartRefreshSeconds()).toBe(60);
    });

    it('uses the default for invalid or unavailable storage', () => {
        vi.stubGlobal('localStorage', {getItem: () => 'invalid'});
        expect(readChartRefreshSeconds()).toBe(30);
        vi.stubGlobal('localStorage', {getItem: () => {throw new Error('unavailable');}});
        expect(readChartRefreshSeconds()).toBe(30);
    });
});
