export interface UserMemory {
    id: string;
    memory_type: string;
    category: string;
    content: string;
    created_at: string;
    updated_at: string;
}

export interface UserMemoryList {
    enabled: boolean;
    memories: UserMemory[];
}

export interface UserMemoryInput {
    memory_type: string;
    category: string;
    content: string;
}

export interface UserMemoryProgress {
    processed: number;
    total: number;
    title: string;
}

export interface UserMemoryRefreshResult {
    processed: number;
    changed: number;
}

async function memoryRequest<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`/api/user-memories${path}`, init);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json() as Promise<T>;
}

const jsonRequest = (method: string, body: unknown): RequestInit => ({
    method,
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify(body),
});

export const getUserMemories = () => memoryRequest<UserMemoryList>('');
export const setUserMemoryEnabled = (enabled: boolean) =>
    memoryRequest<{enabled: boolean}>('/settings', jsonRequest('PUT', {enabled}));
export async function refreshUserMemories(
    onProgress: (progress: UserMemoryProgress) => void,
    signal?: AbortSignal,
): Promise<UserMemoryRefreshResult> {
    const response = await fetch('/api/user-memories/refresh/stream', {method: 'POST', signal});
    if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let result: UserMemoryRefreshResult | null = null;
    while (true) {
        const {done, value} = await reader.read();
        buffer += decoder.decode(value, {stream: !done}).replace(/\r\n/g, '\n');
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const item of events) {
            const event = item.match(/^event: (\w+)/m)?.[1];
            const data = item.match(/^data: (.+)/m)?.[1];
            if (!event || !data) continue;
            const parsed = JSON.parse(data);
            if (event === 'progress') onProgress(parsed as UserMemoryProgress);
            if (event === 'done') result = parsed as UserMemoryRefreshResult;
            if (event === 'error') throw new Error(parsed.code || 'failed');
        }
        if (done) break;
    }
    if (!result) throw new Error('failed');
    return result;
}
export const updateUserMemory = (id: string, input: UserMemoryInput) =>
    memoryRequest<UserMemory>(`/${encodeURIComponent(id)}`, jsonRequest('PUT', input));
export const deleteUserMemory = (id: string) =>
    memoryRequest<{ok: boolean}>(`/${encodeURIComponent(id)}`, {method: 'DELETE'});
export const deleteAllUserMemories = () =>
    memoryRequest<{ok: boolean}>('', {method: 'DELETE'});
