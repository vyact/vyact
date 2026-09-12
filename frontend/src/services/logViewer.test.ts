import {applyLogUpdates, subscribeLogs} from './logViewer';
import {afterEach, beforeAll, describe, expect, it, vi} from 'vitest';
import i18n from 'i18next';
import {api, LLM_LOGGING_CHANGED} from './api';

vi.mock('../i18n', async () => ({default: (await import('i18next')).default}));
beforeAll(async () => {await i18n.init({lng: 'en', resources: {}});});
afterEach(() => {vi.unstubAllGlobals();});

describe('log viewer API', () => {
    it('broadcasts the persisted logging state for both views', async () => {
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', {dispatchEvent});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{"llm_logging":true}')));
        await api.setLlmLogging(true);
        expect(dispatchEvent).toHaveBeenCalledOnce();
        expect(dispatchEvent.mock.calls[0][0].type).toBe(LLM_LOGGING_CHANGED);
        expect(dispatchEvent.mock.calls[0][0].detail).toBe(true);
    });
    it('does not publish a failed settings update', async () => {
        const dispatchEvent = vi.fn();
        vi.stubGlobal('window', {dispatchEvent});
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', {status: 500})));
        await expect(api.setLlmLogging(true)).rejects.toThrow();
        expect(dispatchEvent).not.toHaveBeenCalled();
    });
    it('connects once with the model and closes the SSE subscription', () => {
        const source = {onmessage: null as unknown, onerror: null as unknown, close: vi.fn()};
        const urls: string[] = [];
        vi.stubGlobal('EventSource', class {constructor(url: string) {urls.push(url); return source;}});
        const update = vi.fn();
        const close = subscribeLogs('llm', 'mlx/org/model', update, vi.fn());
        expect(new URL(urls[0], 'http://localhost').searchParams.get('model')).toBe('mlx/org/model');
        (source.onmessage as (event: {data: string}) => void)({data: '{"files":[]}'});
        expect(update).toHaveBeenCalledWith([]);
        close();
        expect(source.close).toHaveBeenCalledOnce();
        expect(source.onmessage).toBeNull();
    });
    it('appends deltas without changing the snapshot being read and resets on reconnect', () => {
        const initial = applyLogUpdates([], [{name: 'app', path: '/app.log', reset: true, content: 'first'}]);
        const latest = applyLogUpdates(initial, [{name: 'app', path: '/app.log', reset: false, content: ' second'}]);
        expect(initial[0].content).toBe('first');
        expect(latest[0].content).toBe('first second');
        const reconnected = applyLogUpdates(latest, [{name: 'app', path: '/app.log', reset: true, content: 'first second'}]);
        expect(reconnected[0].content).toBe('first second');
    });
    it('bounds the background buffer while preserving the visible snapshot', () => {
        const visible = [{name: 'app', path: '/app.log', content: 'reading'}];
        const latest = applyLogUpdates(visible, [{name: 'app', path: '/app.log', reset: false, content: 'x'.repeat(300_000)}]);
        expect(latest[0].content.length).toBe(256 * 1024);
        expect(visible[0].content).toBe('reading');
    });
});
