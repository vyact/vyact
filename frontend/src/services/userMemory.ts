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
export const refreshUserMemories = () =>
    memoryRequest<{processed: number; changed: number}>('/refresh', {method: 'POST'});
export const createUserMemory = (input: UserMemoryInput) =>
    memoryRequest<UserMemory>('', jsonRequest('POST', input));
export const updateUserMemory = (id: string, input: UserMemoryInput) =>
    memoryRequest<UserMemory>(`/${encodeURIComponent(id)}`, jsonRequest('PUT', input));
export const deleteUserMemory = (id: string) =>
    memoryRequest<{ok: boolean}>(`/${encodeURIComponent(id)}`, {method: 'DELETE'});
export const deleteAllUserMemories = () =>
    memoryRequest<{ok: boolean}>('', {method: 'DELETE'});
