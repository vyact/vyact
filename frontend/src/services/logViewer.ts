export interface LogUpdate {name: string; path: string; reset: boolean; content: string}
export interface LogFile {name: string; path: string; content: string}
const MAX_LOG_CHARACTERS = 256 * 1024;

// Keep a bounded latest snapshot separately from the snapshot being read on screen.
export function applyLogUpdates(files: LogFile[], updates: LogUpdate[]): LogFile[] {
    const next = new Map(files.map(file => [file.name, file]));
    for (const update of updates) {
        const previous = next.get(update.name);
        const content = (update.reset ? update.content : (previous?.content || '') + update.content)
            .slice(-MAX_LOG_CHARACTERS);
        next.set(update.name, {name: update.name, path: update.path, content});
    }
    return [...next.values()];
}

export function subscribeLogs(kind: 'app' | 'llm', model: string,
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
