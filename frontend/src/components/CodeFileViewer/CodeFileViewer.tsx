import React, { useState } from 'react';
import {useTranslation} from 'react-i18next';
import { useCodePanel } from '../../contexts/CodePanelContext';
import './CodeFileViewer.css';

export interface CodeFile {
    name: string;
    lang: string;
    code: string;
    mode?: 'code' | 'diff';
    additions?: number;
    deletions?: number;
}

interface CodeFileViewerProps {
    files: CodeFile[];
}

const EXT_LABEL: Record<string, string> = {
    tsx: 'TSX', ts: 'TypeScript', jsx: 'JSX', js: 'JavaScript',
    css: 'CSS', scss: 'SCSS', py: 'Python', java: 'Java',
    json: 'JSON', md: 'Markdown', html: 'HTML', sh: 'Shell',
    yaml: 'YAML', yml: 'YAML', sql: 'SQL', rs: 'Rust', go: 'Go',
};

function downloadFile(file: CodeFile) {
    const blob = new Blob([file.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

const CodeFileViewer: React.FC<CodeFileViewerProps> = ({ files }) => {
    const {t} = useTranslation('main');
    const { openPanel, panel } = useCodePanel();
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const [viewerId] = useState(() => Math.random().toString(36).slice(2));

    const isThisActive = panel?.viewerId === viewerId;

    const handleItemClick = (i: number) => {
        openPanel(files, i, viewerId);
    };

    return (
        <div className="cfv-list-only">
            <div className="cfv-list-items">
                {files.map((f, i) => {
                    const extLabel = EXT_LABEL[f.lang.toLowerCase()] ?? f.lang.toUpperCase();
                    const isActive = isThisActive && panel?.activeIdx === i;
                    return (
                        <div
                            key={i}
                            className={`cfv-item${isActive ? ' cfv-item--active' : ''}`}
                            onClick={() => handleItemClick(i)}
                        >
                            <div className="cfv-icon" aria-hidden="true">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="1.8">
                                    <polyline points="16 18 22 12 16 6"/>
                                    <polyline points="8 6 2 12 8 18"/>
                                </svg>
                            </div>
                            <div className="cfv-info">
                                <div className="cfv-name">{f.name}</div>
                                <div className="cfv-type">코드 · {extLabel}</div>
                            </div>
                            <button
                                className={`cfv-copy-btn${copiedIdx === i ? ' cfv-copy-btn--copied' : ''}`}
                                onClick={e => {
                                    e.stopPropagation();
                                    const text = f.code;
                                    if (window.ragAPI?.copyToClipboard) {
                                        window.ragAPI.copyToClipboard(text);
                                    } else if (navigator.clipboard) {
                                        navigator.clipboard.writeText(text).catch(() => {
                                            const ta = document.createElement('textarea');
                                            ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                                            document.body.appendChild(ta); ta.focus(); ta.select();
                                            document.execCommand('copy'); document.body.removeChild(ta);
                                        });
                                    } else {
                                        const ta = document.createElement('textarea');
                                        ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
                                        document.body.appendChild(ta); ta.focus(); ta.select();
                                        document.execCommand('copy'); document.body.removeChild(ta);
                                    }
                                    setCopiedIdx(i);
                                    setTimeout(() => setCopiedIdx(null), 1800);
                                }}
                            >
                                {copiedIdx === i ? (
                                    <>
                                        <svg width="11" height="11" viewBox="0 0 24 24" fill="none"
                                             stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                            <polyline points="20 6 9 17 4 12"/>
                                        </svg>
                                        {t('codeFileViewer.copied')}
                                    </>
                                ) : t('codeFileViewer.copy')}
                            </button>
                            <button
                                className="cfv-dl-btn"
                                onClick={e => { e.stopPropagation(); downloadFile(f); }}
                            >
                                {t('codeFileViewer.download')}
                            </button>
                        </div>
                    );
                })}
            </div>
            {files.length > 1 && (
                <button className="cfv-all-btn" onClick={() => files.forEach(downloadFile)}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
                         stroke="currentColor" strokeWidth="2" aria-hidden="true">
                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                        <polyline points="7 10 12 15 17 10"/>
                        <line x1="12" y1="15" x2="12" y2="3"/>
                    </svg>
                    {t('codeFileViewer.downloadAll')}
                </button>
            )}
        </div>
    );
};

export default CodeFileViewer;
