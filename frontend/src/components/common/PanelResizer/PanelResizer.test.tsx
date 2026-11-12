import {renderToStaticMarkup} from 'react-dom/server';
import {afterEach, expect, it, vi} from 'vitest';
import PanelResizer from './PanelResizer';

const hooks = vi.hoisted(() => ({callbacks: [] as ((...args: any[]) => unknown)[], cleanup: undefined as (() => void) | undefined}));
vi.mock('react', async () => ({...await vi.importActual('react'),
    useState: () => [false, vi.fn()],
    useRef: (current: unknown) => ({current}),
    useCallback: (callback: (...args: any[]) => unknown) => {hooks.callbacks.push(callback); return callback;},
    useEffect: (effect: () => (() => void)) => {hooks.cleanup = effect();},
}));
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
afterEach(() => {hooks.cleanup?.(); hooks.callbacks = []; vi.unstubAllGlobals();});

it('coalesces mouse moves per frame and commits the final pending width on release', () => {
    const events = new Map<string, (event?: unknown) => void>();
    const frames = new Map<number, () => void>();
    let sequence = 0;
    const remove = vi.fn();
    vi.stubGlobal('window', {addEventListener: (type: string, callback: () => void) => events.set(type, callback), removeEventListener: vi.fn()});
    vi.stubGlobal('document', {body: {style: {}, appendChild: vi.fn()}, createElement: () => ({style: {}, remove}),
        querySelector: () => ({getBoundingClientRect: () => ({right: 1000, width: 1000})})});
    vi.stubGlobal('requestAnimationFrame', (callback: () => void) => {frames.set(++sequence, callback); return sequence;});
    vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
    const change = vi.fn();
    const end = vi.fn();
    const start = vi.fn();
    renderToStaticMarkup(<PanelResizer onWidthChange={change} onResizeStart={start} onResizeEnd={end}/>);
    hooks.callbacks[0]({preventDefault() {}, currentTarget: {getBoundingClientRect: () => ({right: 500})}});
    events.get('mousemove')!({clientX: 600});
    events.get('mousemove')!({clientX: 500});
    expect(change).not.toHaveBeenCalled();
    expect(frames.size).toBe(1);
    const frame = frames.values().next().value!;
    frames.clear(); frame();
    expect(change).toHaveBeenCalledExactlyOnceWith(50);
    events.get('mousemove')!({clientX: 400});
    events.get('mouseup')!();
    expect(change).toHaveBeenLastCalledWith(60);
    expect(end).toHaveBeenCalledExactlyOnceWith(60);
    expect(start).toHaveBeenCalledOnce();
    expect(frames.size).toBe(0);
    expect(remove).toHaveBeenCalledOnce();
});
