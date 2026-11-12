import type {MessageStats} from '../types';

export interface StockChatEvent extends MessageStats {
    completed?: number;
    total?: number;
    failed?: number;
    model?: string;
    type: string;
    text?: string;
    phase?: string;
    name?: string;
    id?: string;
    args?: Record<string, unknown>;
    result?: unknown;
}

export async function readStockChatStream(response: Response, onEvent: (event: StockChatEvent) => void): Promise<void> {
    if (!response.body) throw new Error('empty_stream');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let done = false;
    const consume = (line: string) => {
        if (!line.trim()) return;
        const event: StockChatEvent = JSON.parse(line);
        if (event.type === 'error') throw new Error('chat_stream_failed');
        if (event.type === 'done') done = true;
        else onEvent(event);
    };
    try {
        while (true) {
            const chunk = await reader.read();
            buffer += decoder.decode(chunk.value, {stream: !chunk.done});
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? '';
            lines.forEach(consume);
            if (chunk.done) break;
        }
        consume(buffer);
        if (!done) throw new Error('incomplete_stream');
    } finally {
        reader.releaseLock();
    }
}
