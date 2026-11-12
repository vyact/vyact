import {expect, it, vi} from 'vitest';
import useAutoSizeTextarea from './useAutoSizeTextarea';

const state = vi.hoisted(() => ({cleanup: undefined as (() => void) | undefined}));
vi.mock('react', () => ({useLayoutEffect: (effect: () => (() => void) | undefined) => {state.cleanup = effect();}}));

it('refits a narrow collapsed input when expanded and ignores height-only notifications', () => {
    let notify = () => {};
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class {
        constructor(callback: () => void) {notify = callback;}
        observe() {}
        disconnect = disconnect;
    });
    try {
        const input = {clientWidth: 20, scrollHeight: 400, style: {height: ''}};
        useAutoSizeTextarea({current: input as HTMLTextAreaElement}, '', 180);
        expect(input.style.height).toBe('180px');
        input.clientWidth = 300;
        input.scrollHeight = 24;
        notify();
        expect(input.style.height).toBe('24px');
        input.scrollHeight = 100;
        notify();
        expect(input.style.height).toBe('24px');
        input.clientWidth = 0;
        notify();
        expect(input.style.height).toBe('24px');
        input.clientWidth = 300;
        notify();
        expect(input.style.height).toBe('100px');
        state.cleanup?.();
        expect(disconnect).toHaveBeenCalledOnce();
    } finally {vi.unstubAllGlobals();}
});
