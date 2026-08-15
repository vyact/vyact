export interface DocumentFileRecord {
    file_id: string;
    filename: string;
    file_ext: string;
    file_size: number;
    chunk_count: number;
    indexed_at: string;
    has_original: boolean;
    source_type?: 'document' | 'web';
    url?: string;
    domain?: string;
    content?: string;
}

let cachedDocumentFiles: DocumentFileRecord[] | null = null;
let documentFilesRequest: Promise<DocumentFileRecord[]> | null = null;

export function getDocumentFiles(forceRefresh = false): Promise<DocumentFileRecord[]> {
    if (!forceRefresh && cachedDocumentFiles) return Promise.resolve(cachedDocumentFiles);
    if (documentFilesRequest) return documentFilesRequest;
    documentFilesRequest = fetch('/api/document/files')
        .then(response => {
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.json() as Promise<{files?: DocumentFileRecord[]}>;
        })
        .then(result => {
            cachedDocumentFiles = result.files || [];
            return cachedDocumentFiles;
        })
        .finally(() => {
            documentFilesRequest = null;
        });
    return documentFilesRequest;
}

export function invalidateDocumentFiles(): void {
    cachedDocumentFiles = null;
}

export function removeCachedDocumentFiles(fileIds: string[]): void {
    if (!cachedDocumentFiles) return;
    const removedIds = new Set(fileIds);
    cachedDocumentFiles = cachedDocumentFiles.filter(file => !removedIds.has(file.file_id));
}
