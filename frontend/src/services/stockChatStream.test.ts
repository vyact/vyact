import {describe, expect, it} from 'vitest';
import {readStockChatStream, type StockChatEvent} from './stockChatStream';

function response(chunks: string[]): Response {
    const encoder = new TextEncoder();
    return new Response(new ReadableStream({start(controller) {
        chunks.forEach(chunk => controller.enqueue(encoder.encode(chunk)));
        controller.close();
    }}));
}

describe('stock chat stream', () => {
    it('delivers tool events and split answer tokens in order', async () => {
        const events: StockChatEvent[] = [];
        await readStockChatStream(response([
            '{"type":"tool","phase":"start","name":"search"}\n{"type":"tok',
            'en","text":"분석"}\n{"type":"tool","phase":"end","name":"search"}\n',
            '{"type":"done"}\n',
        ]), event => events.push(event));
        expect(events.map(event => event.type)).toEqual(['tool', 'token', 'tool']);
        expect(events[1].text).toBe('분석');
    });
    it('delivers preparation progress before model events', async () => {
        const events: StockChatEvent[] = [];
        await readStockChatStream(response([
            '{"type":"preparation","completed":0,"total":10,"failed":0}\n',
            '{"type":"preparation","completed":10,"total":10,"failed":2}\n',
            '{"type":"model","model":"test"}\n{"type":"token","text":"answer"}\n{"type":"done"}\n',
        ]), event => events.push(event));
        expect(events.map(event => event.type)).toEqual(['preparation', 'preparation', 'model', 'token']);
        expect(events[1]).toMatchObject({completed: 10, total: 10, failed: 2});
    });
    it('rejects interrupted streams and explicit failures', async () => {
        await expect(readStockChatStream(response(['{"type":"token","text":"partial"}\n']), () => {})).rejects.toThrow('incomplete_stream');
        await expect(readStockChatStream(response(['{"type":"error"}\n']), () => {})).rejects.toThrow('chat_stream_failed');
    });
});
