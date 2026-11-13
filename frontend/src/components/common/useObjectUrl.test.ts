import {beforeEach, expect, it, vi} from 'vitest';
import useObjectUrl from './useObjectUrl';

const state = vi.hoisted(() => ({url: undefined as string | undefined, effect: undefined as (() => (() => void) | undefined) | undefined}));
vi.mock('react', () => ({
    useState: () => [state.url, (url: string | undefined) => {state.url = url;}],
    useEffect: (effect: () => (() => void) | undefined) => {state.effect = effect;},
}));
beforeEach(() => {state.url = undefined; state.effect = undefined;});

it('creates a fresh usable URL when StrictMode replays the effect', () => {
    const activeUrls = new Set<string>();
    let sequence = 0;
    const create = vi.spyOn(URL, 'createObjectURL').mockImplementation(() => {
        const url = `blob:preview-${++sequence}`;
        activeUrls.add(url);
        return url;
    });
    const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(url => {activeUrls.delete(url);});
    try {
        const file = new File(['image'], 'chart.png', {type: 'image/png'});
        useObjectUrl(file);
        const setup = state.effect!;
        const firstCleanup = setup();
        const firstUrl = state.url;
        firstCleanup?.();
        expect(activeUrls.has(firstUrl!)).toBe(false);
        const secondCleanup = setup();
        const visibleUrl = useObjectUrl(file);
        expect(visibleUrl).not.toBe(firstUrl);
        expect(activeUrls.has(visibleUrl!)).toBe(true);
        secondCleanup?.();
        expect(activeUrls.size).toBe(0);
        expect(create).toHaveBeenCalledTimes(2);
        expect(revoke).toHaveBeenCalledTimes(2);
    } finally {create.mockRestore(); revoke.mockRestore();}
});
