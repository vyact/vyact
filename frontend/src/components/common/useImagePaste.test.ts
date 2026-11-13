import {afterEach, expect, it, vi} from 'vitest';
import useImagePaste from './useImagePaste';

const state = vi.hoisted(() => ({effect: undefined as (() => (() => void) | undefined) | undefined}));
vi.mock('react', () => ({useEffect: (effect: () => (() => void) | undefined) => {state.effect = effect;}}));
afterEach(() => {vi.unstubAllGlobals();});

function clipboardEvent(type: string): ClipboardEvent {
    const event = new Event('paste', {cancelable: true});
    Object.defineProperty(event, 'clipboardData', {value: {items: [{type}]}});
    return event as ClipboardEvent;
}

it('receives image paste at document level without a focused textarea and cleans up', () => {
    const document = new EventTarget();
    vi.stubGlobal('document', document);
    const paste = vi.fn((event: ClipboardEvent) => event.preventDefault());
    useImagePaste(true, paste);
    const cleanup = state.effect!();
    const event = clipboardEvent('image/png');
    document.dispatchEvent(event);
    expect(paste).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    document.dispatchEvent(clipboardEvent('text/plain'));
    const handled = clipboardEvent('image/png');
    handled.preventDefault();
    document.dispatchEvent(handled);
    expect(paste).toHaveBeenCalledOnce();
    cleanup?.();
    document.dispatchEvent(clipboardEvent('image/png'));
    expect(paste).toHaveBeenCalledOnce();
});

it('does not intercept paste when the panel is collapsed or busy', () => {
    const document = new EventTarget();
    vi.stubGlobal('document', document);
    const paste = vi.fn();
    useImagePaste(false, paste);
    expect(state.effect!()).toBeUndefined();
    document.dispatchEvent(clipboardEvent('image/png'));
    expect(paste).not.toHaveBeenCalled();
});
