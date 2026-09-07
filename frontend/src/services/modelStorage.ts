export interface ModelStorageStatus {
    path: string;
    busy: boolean;
    phase: string;
    copied_bytes: number;
    total_bytes: number;
    current_file?: string;
    error?: string;
    warning?: string;
}
export interface ModelStoragePlan {
    source: string;
    destination: string;
    selected_directory: string;
    same: boolean;
    total_bytes: number;
}
async function request<T>(suffix = '', path?: string): Promise<T> {
    const response = await fetch(`/api/vyact/model-storage${suffix}`, path === undefined ? undefined : {
        method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({path}),
    });
    const value = await response.json();
    if (!response.ok) throw new Error(value.code || value.detail || 'storage_failed');
    return value;
}
export const modelStorage = {
    status: () => request<ModelStorageStatus>(),
    plan: (path: string) => request<ModelStoragePlan>('/plan', path),
    move: (path: string) => request<{same: boolean}>('/move', path),
};
