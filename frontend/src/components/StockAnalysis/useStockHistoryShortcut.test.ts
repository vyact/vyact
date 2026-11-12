import {afterEach, expect, it, vi} from 'vitest';
import useStockHistoryShortcut from './useStockHistoryShortcut';

const state = vi.hoisted(() => ({cleanup: undefined as (() => void) | undefined}));
vi.mock('react', () => ({useRef: (current: unknown) => ({current}), useEffect: (effect: () => (() => void)) => {state.cleanup = effect();}}));
afterEach(() => {state.cleanup?.(); vi.unstubAllGlobals();});

it('opens stock history and consumes the shortcut before global chat handlers', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', {querySelectorAll: () => []});
    const open = vi.fn();
    useStockHistoryShortcut(open, false);
    const event = new Event('keydown', {cancelable: true});
    Object.assign(event, {metaKey: true, shiftKey: true, code: 'KeyH', key: 'H'});
    target.dispatchEvent(event);
    expect(open).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
    state.cleanup?.();
    target.dispatchEvent(event);
    expect(open).toHaveBeenCalledOnce();
});
it('does not open history while sending or with another modal open', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', {querySelectorAll: () => []});
    const open = vi.fn();
    useStockHistoryShortcut(open, true);
    const event = new Event('keydown', {cancelable: true});
    Object.assign(event, {ctrlKey: true, shiftKey: true, code: 'KeyH', key: 'H'});
    target.dispatchEvent(event);
    expect(open).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
});

it('allows the shortcut to close its own history modal', () => {
    const target = new EventTarget();
    vi.stubGlobal('window', target);
    vi.stubGlobal('document', {querySelectorAll: () => [{matches: (selector: string) => selector === '.stock-chat-history-overlay'}]});
    const toggle = vi.fn();
    useStockHistoryShortcut(toggle, false, true);
    const event = new Event('keydown', {cancelable: true});
    Object.assign(event, {metaKey: true, shiftKey: true, code: 'KeyH', key: 'H'});
    target.dispatchEvent(event);
    expect(toggle).toHaveBeenCalledOnce();
});
