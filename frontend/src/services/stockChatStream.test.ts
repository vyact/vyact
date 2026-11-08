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
    it('rejects interrupted streams and explicit failures', async () => {
        await expect(readStockChatStream(response(['{"type":"token","text":"partial"}\n']), () => {})).rejects.toThrow('incomplete_stream');
        await expect(readStockChatStream(response(['{"type":"error"}\n']), () => {})).rejects.toThrow('chat_stream_failed');
    });
});
