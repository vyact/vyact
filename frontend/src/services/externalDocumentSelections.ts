export interface ExternalDocumentSelection {
    source_id: string;
    document_id: string;
    title: string;
}

export const EXTERNAL_DOCUMENT_SELECTIONS_UPDATED_EVENT = 'vyact:external-document-selections-updated';
const STORAGE_KEY = 'vyact:external-document-selections';

const readSelections = (): ExternalDocumentSelection[] => {
    try {
        const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
};

let selections = readSelections();

export const getExternalDocumentSelections = () => selections;

export const updateExternalDocumentSelections = (updater: (current: ExternalDocumentSelection[]) => ExternalDocumentSelection[]) => {
    selections = updater(selections);
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(selections));
    } catch {
        // Storage can be unavailable in restricted browser contexts.
    }
    window.dispatchEvent(new Event(EXTERNAL_DOCUMENT_SELECTIONS_UPDATED_EVENT));
};

export const toggleExternalDocumentSelection = (document: ExternalDocumentSelection) => {
    updateExternalDocumentSelections(current => current.some(item => item.source_id === document.source_id && item.document_id === document.document_id)
        ? current.filter(item => item.source_id !== document.source_id || item.document_id !== document.document_id)
        : [...current, document]);
};
