import {useEffect, useState, type CSSProperties} from 'react';
import {useTranslation} from 'react-i18next';
import {marked} from 'marked';
import {X} from 'lucide-react';
import {documentExtension, useDocumentPreview} from '../../contexts/DocumentPreviewContext';
import {usePanelManager} from '../../contexts/PanelManagerContext';
import './DocumentPreviewPanel.css';
import previewContentStyles from './documentPreviewContent.css?raw';
import {usePreviewTheme} from './usePreviewTheme';

function previewHtml(content: string, theme: string): string {
    return `<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline';"><style>${theme}${previewContentStyles}</style></head><body>${content}</body></html>`;
}
export default function DocumentPreviewPanel({style}: {style: CSSProperties}) {
    const {document} = useDocumentPreview();
    const panels = usePanelManager();
    const previewTheme = usePreviewTheme();
    const {t} = useTranslation('main');
    const [result, setResult] = useState<{url?: string; text?: string; html?: string} | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        if (!document) return;
        const controller = new AbortController();
        let objectUrl: string | undefined;
        setResult(null);
        setFailed(false);
        const load = async () => {
            const response = await fetch(document.url, {signal: controller.signal});
            if (!response.ok) throw new Error('Document unavailable');
            const blob = await response.blob();
            const ext = documentExtension(document.name);
            let next: NonNullable<typeof result>;
            if (ext === 'pdf') {
                objectUrl = URL.createObjectURL(new Blob([blob], {type: 'application/pdf'}));
                next = {url: objectUrl};
            } else if (['docx', 'xlsx', 'pptx'].includes(ext)) {
                const form = new FormData();
                form.append('file', blob, document.name);
                const parsed = await fetch('/api/document/parse', {method: 'POST', body: form, signal: controller.signal});
                if (!parsed.ok) throw new Error('Document parsing failed');
                next = {text: (await parsed.json()).content};
            } else {
                const text = await blob.text();
                next = ext === 'txt' ? {text} : {html: ext === 'md' ? await marked.parse(text) : text};
            }
            if (!controller.signal.aborted) setResult(next);
        };
        void load().catch(() => {if (!controller.signal.aborted) setFailed(true);});
        return () => {controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl);};
    }, [document]);
    if (!document) return null;
    const extracted = ['docx', 'xlsx', 'pptx'].includes(documentExtension(document.name));
    return <aside className="document-preview-panel" style={style}>
        <div className="document-preview-header">
            <span>{document.name}</span>
            <button type="button" className="icon-btn" aria-label={t('documentPreview.close')} onClick={() => panels.close('document-preview')}><X size={18}/></button>
        </div>
        {extracted && <div className="document-preview-note">{t('documentPreview.extracted')}</div>}
        {failed ? <div className="document-preview-status" role="alert">{t('documentPreview.error')}</div>
            : !result ? <div className="document-preview-status" role="status">{t('documentPreview.loading')}</div>
            : result.url ? <iframe aria-label={document.name} src={result.url}/>
            : result.html !== undefined ? <iframe aria-label={document.name} sandbox="" srcDoc={previewHtml(result.html, previewTheme)}/>
            : <pre className="document-preview-text">{result.text}</pre>}
    </aside>;
}
