import {createContext, useCallback, useContext, useState, type ReactNode} from 'react';
import {usePanelManager} from './PanelManagerContext';

export interface PreviewDocument {name: string; url: string}
export const DOCUMENT_PREVIEW_EXTENSIONS = new Set(['pdf', 'docx', 'xlsx', 'pptx', 'txt', 'html', 'htm', 'md']);
export const documentExtension = (name: string) => name.split('.').pop()?.toLowerCase() || '';
export const canPreviewDocument = (name: string) => DOCUMENT_PREVIEW_EXTENSIONS.has(documentExtension(name));
const DocumentPreviewContext = createContext<{document: PreviewDocument | null; openDocument: (document: PreviewDocument) => void} | null>(null);
export function DocumentPreviewProvider({children}: {children: ReactNode}) {
    const [document, setDocument] = useState<PreviewDocument | null>(null);
    const panels = usePanelManager();
    const openDocument = useCallback((next: PreviewDocument) => {
        if (!canPreviewDocument(next.name)) return;
        setDocument(next);
        panels.open('document-preview');
    }, [panels.open]);
    return <DocumentPreviewContext.Provider value={{document, openDocument}}>{children}</DocumentPreviewContext.Provider>;
}
export function useDocumentPreview() {
    const context = useContext(DocumentPreviewContext);
    if (!context) throw new Error('DocumentPreviewProvider is required');
    return context;
}
