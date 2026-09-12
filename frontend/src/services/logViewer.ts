import {parseTextLogs} from './textLogParser';
export type LogKind = 'app' | 'model' | 'llm';
export interface LogUpdate {name: string; path: string; reset: boolean; content: string}
export interface LogFile {name: string; path: string; content: string}
const MAX_LOG_CHARACTERS = 256 * 1024;
const MAX_LOG_ENTRIES = 1000;

function limitLogContent(content: string, name: string): string {
    const bounded = content.slice(-MAX_LOG_CHARACTERS);
    if (name === 'llm') {
        const lines = bounded.split('\n').filter(line => line.trim());
        return lines.slice(-MAX_LOG_ENTRIES).join('\n') + (bounded.endsWith('\n') && lines.length ? '\n' : '');
    }
    return parseTextLogs(bounded).slice(-MAX_LOG_ENTRIES).map(entry => entry.raw).join('\n');
}

// Keep a bounded latest snapshot separately from the snapshot being read on screen.
export function applyLogUpdates(files: LogFile[], updates: LogUpdate[]): LogFile[] {
    const next = new Map(files.map(file => [file.name, file]));
    for (const update of updates) {
        const previous = next.get(update.name);
        const content = limitLogContent(update.reset ? update.content : (previous?.content || '') + update.content, update.name);
        next.set(update.name, {name: update.name, path: update.path, content});
    }
    return [...next.values()];
}

export function subscribeLogs(kind: LogKind, model: string,
    onUpdate: (updates: LogUpdate[]) => void, onError: (failed: boolean) => void): () => void {
    const source = new EventSource(`/api/logs/stream?${new URLSearchParams({kind, model})}`);
    source.onmessage = event => {
        try {
            const payload = JSON.parse(event.data) as {files: LogUpdate[]};
            onUpdate(payload.files);
            onError(false);
        } catch {onError(true);}
    };
    source.onerror = () => onError(true);
    // EventSource reconnects automatically; the server resets each file on reconnect.
    return () => {source.onmessage = null; source.onerror = null; source.close();};
}
