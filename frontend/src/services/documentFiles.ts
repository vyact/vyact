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
let documentEvents: EventSource | null = null;
const documentChangeListeners = new Set<() => void>();
let documentChangeSubscriptions = 0;

export function getDocumentFiles(forceRefresh = false): Promise<DocumentFileRecord[]> {
    if (!forceRefresh && cachedDocumentFiles) return Promise.resolve(cachedDocumentFiles);
    if (documentFilesRequest) {
        return forceRefresh
            ? documentFilesRequest.then(() => getDocumentFiles(true))
            : documentFilesRequest;
    }
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

export function subscribeDocumentFileChanges(listener?: () => void): () => void {
    if (listener) documentChangeListeners.add(listener);
    documentChangeSubscriptions += 1;
    if (!documentEvents) {
        documentEvents = new EventSource('/api/document/events');
        documentEvents.addEventListener('changed', () => {
            invalidateDocumentFiles();
            documentChangeListeners.forEach(changeListener => changeListener());
        });
    }

    return () => {
        if (listener) documentChangeListeners.delete(listener);
        documentChangeSubscriptions = Math.max(0, documentChangeSubscriptions - 1);
        if (documentChangeSubscriptions === 0 && documentEvents) {
            documentEvents.close();
            documentEvents = null;
        }
    };
}
