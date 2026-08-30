import React, { useEffect, useMemo, useRef, useState } from 'react';
import {ChevronDown, ChevronLeft, ChevronRight, Search} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import hljs from '../../utils/syntaxHighlighter';
import 'highlight.js/styles/github-dark.css';
import { useCodePanel } from '../../contexts/CodePanelContext';
import type { CodeFile } from '../CodeFileViewer/CodeFileViewer';
import './CodePanel.css';

const EXT_LABEL: Record<string, string> = {
    tsx: 'TSX', ts: 'TypeScript', jsx: 'JSX', js: 'JavaScript',
    css: 'CSS', scss: 'SCSS', py: 'Python', java: 'Java',
    json: 'JSON', md: 'Markdown', html: 'HTML', sh: 'Shell',
    yaml: 'YAML', yml: 'YAML', sql: 'SQL', rs: 'Rust', go: 'Go',
};

const FILE_ACCENT: Record<string, string> = {
    tsx: 'blue', ts: 'blue', jsx: 'blue', js: 'yellow',
    css: 'pink', scss: 'pink', py: 'green', java: 'red',
    json: 'yellow', md: 'blue', html: 'orange', sh: 'green',
    yaml: 'red', yml: 'red', sql: 'blue', rs: 'orange', go: 'blue',
};

function highlightCode(code: string, lang: string): string[] {
    const trimmed = code.trim();
    let html: string;
    if (hljs.getLanguage(lang)) {
        html = hljs.highlight(trimmed, { language: lang }).value;
    } else {
        html = hljs.highlightAuto(trimmed).value;
    }
    const lines = html.split('\n');
    if (lines[lines.length - 1] === '') lines.pop();
    return lines;
}

function downloadFile(file: CodeFile) {
    const blob = new Blob([file.code], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = file.name;
    a.click();
    URL.revokeObjectURL(url);
}

const CodePanel: React.FC<{ style?: React.CSSProperties }> = ({ style }) => {
    const {t} = useTranslation('main');
    const { panel, setActiveIdx, closePanel } = useCodePanel();
    const [copiedPanel, setCopiedPanel] = useState<typeof panel>(null);
    const [fileMenuOpen, setFileMenuOpen] = useState(false);
    const [fileQuery, setFileQuery] = useState('');
    const fileNavRef = useRef<HTMLDivElement>(null);

    const activeFile = panel ? panel.files[panel.activeIdx] : null;
    const filteredFiles = useMemo(() => {
        if (!panel) return [];
        const normalizedQuery = fileQuery.trim().toLocaleLowerCase();
        return panel.files
            .map((file, index) => ({file, index}))
            .filter(({file}) => !normalizedQuery || file.name.toLocaleLowerCase().includes(normalizedQuery));
    }, [panel, fileQuery]);

    const lines = useMemo(() => {
        if (!activeFile) return [];
        if (activeFile.mode === 'diff') return activeFile.code.trimEnd().split('\n');
        return highlightCode(activeFile.code, activeFile.lang);
    }, [activeFile]);

    useEffect(() => {
        setFileMenuOpen(false);
        setFileQuery('');
    }, [panel?.viewerId]);

    useEffect(() => {
        if (!fileMenuOpen) return;
        const closeOnOutsideClick = (event: PointerEvent) => {
            if (!fileNavRef.current?.contains(event.target as Node)) setFileMenuOpen(false);
        };
        const closeOnEscape = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setFileMenuOpen(false);
        };
        document.addEventListener('pointerdown', closeOnOutsideClick);
        document.addEventListener('keydown', closeOnEscape);
        return () => {
            document.removeEventListener('pointerdown', closeOnOutsideClick);
            document.removeEventListener('keydown', closeOnEscape);
        };
    }, [fileMenuOpen]);

    if (!panel || !activeFile) return null;

    const copied = copiedPanel === panel;
    const extLabel = EXT_LABEL[activeFile.lang.toLowerCase()] ?? activeFile.lang.toUpperCase();
    const fileAccent = FILE_ACCENT[activeFile.lang.toLowerCase()] ?? 'gray';
    const lineCount = lines.length;

    const handleCopy = () => {
        const text = activeFile.code;
        if (window.ragAPI?.copyToClipboard) {
            window.ragAPI.copyToClipboard(text);
        } else if (navigator.clipboard) {
            navigator.clipboard.writeText(text).catch(() => fallbackCopy(text));
        } else {
            fallbackCopy(text);
        }
        setCopiedPanel(panel);
        setTimeout(() => setCopiedPanel(null), 1800);
    };

    const fallbackCopy = (text: string) => {
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.top = '0';
        ta.style.left = '0';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.focus();
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        setCopiedPanel(panel);
        setTimeout(() => setCopiedPanel(null), 1800);
    };

    return (
        <div className="cp-wrap" style={style}>
            {/* 상단 헤더 */}
            <div className="cp-header">
                <div className="cp-file-info">
                    <span className={`cp-file-icon cp-file-icon--${fileAccent}`} aria-hidden="true">&lt;/&gt;</span>
                    <div className="cp-file-details">
                        <span className="cp-title">{activeFile.name}</span>
                        <span className="cp-meta">
                            {activeFile.mode === 'diff' ? 'DIFF' : extLabel} <i />
                            {activeFile.mode === 'diff' ? <><b>+{activeFile.additions ?? 0}</b><em>-{activeFile.deletions ?? 0}</em></> : `${lineCount} lines`}
                        </span>
                    </div>
                </div>
                <div className="cp-actions">
                    <button
                        className={`cp-btn${copied ? ' cp-btn--copied' : ''}`}
                        onClick={handleCopy}
                        aria-label={t(copied ? 'message.codeReviewCopied' : 'message.codeReviewCopy')}
                    >
                        {copied ? (
                            <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                {t('message.codeReviewCopied')}
                            </>
                        ) : (
                            <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                {t('message.codeReviewCopy')}
                            </>
                        )}
                    </button>
                    <button
                        className="cp-btn cp-btn--download"
                        onClick={() => downloadFile(activeFile)}
                        aria-label={t('message.codeReviewDownload')}
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        <span className="cp-btn-label">{t('message.codeReviewDownload')}</span>
                    </button>
                    <button
                        className="cp-close"
                        onClick={closePanel}
                        aria-label={t('message.codeReviewClosePanel')}
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* 긴 경로와 많은 파일에 동일하게 대응하는 파일 탐색기 */}
            {panel.files.length > 1 && (
                <div className="cp-file-nav" ref={fileNavRef}>
                    <button
                        className="cp-file-selector"
                        type="button"
                        onClick={() => setFileMenuOpen(open => !open)}
                        aria-expanded={fileMenuOpen}
                        aria-label={t('message.codeReviewFileList')}
                    >
                        <span className="cp-file-selector-name">{activeFile.name}</span>
                        <span className="cp-file-position">{panel.activeIdx + 1} / {panel.files.length}</span>
                        <ChevronDown className={fileMenuOpen ? 'open' : ''} size={15}/>
                    </button>
                    <div className="cp-file-nav-actions">
                        <button type="button" onClick={() => setActiveIdx(panel.activeIdx - 1)} disabled={panel.activeIdx === 0} aria-label={t('message.codeReviewPreviousFile')}>
                            <ChevronLeft size={16}/>
                        </button>
                        <button type="button" onClick={() => setActiveIdx(panel.activeIdx + 1)} disabled={panel.activeIdx === panel.files.length - 1} aria-label={t('message.codeReviewNextFile')}>
                            <ChevronRight size={16}/>
                        </button>
                    </div>
                    {fileMenuOpen && <div className="cp-file-menu">
                        <label className="cp-file-search">
                            <Search size={14}/>
                            <input
                                autoFocus
                                value={fileQuery}
                                onChange={event => setFileQuery(event.target.value)}
                                placeholder={t('common:search')}
                                aria-label={t('message.codeReviewSearchFiles')}
                            />
                        </label>
                        <div className="cp-file-menu-list">
                            {filteredFiles.map(({file, index}) => <button
                                type="button"
                                key={`${file.name}:${index}`}
                                className={panel.activeIdx === index ? 'active' : ''}
                                onClick={() => {
                                    setActiveIdx(index);
                                    setFileMenuOpen(false);
                                    setFileQuery('');
                                }}
                            >
                                <span className="cp-file-menu-main">
                                    <strong>{file.name}</strong>
                                    <small>{EXT_LABEL[file.lang.toLowerCase()] ?? file.lang.toUpperCase()}</small>
                                </span>
                                {file.mode === 'diff' && <span className="cp-file-menu-change"><b>+{file.additions ?? 0}</b><em>-{file.deletions ?? 0}</em></span>}
                            </button>)}
                            {!filteredFiles.length && <div className="cp-file-menu-empty">{t('message.codeReviewNoFiles')}</div>}
                        </div>
                    </div>}
                </div>
            )}

            {/* 코드 영역 */}
            <div className="cp-code">
                <pre className={`cp-pre hljs${activeFile.mode === 'diff' ? ' cp-pre--diff' : ''}`}>
                    <code>
                        {lines.map((line, i) => (
                            <span key={i} className={`cp-line${activeFile.mode === 'diff' ? line.startsWith('+') && !line.startsWith('+++') ? ' cp-line--added' : line.startsWith('-') && !line.startsWith('---') ? ' cp-line--deleted' : line.startsWith('@@') ? ' cp-line--hunk' : line.startsWith('+++') || line.startsWith('---') ? ' cp-line--file' : '' : ''}`}>
                                <span className="cp-lineno" aria-hidden="true">{i + 1}</span>
                                {activeFile.mode === 'diff'
                                    ? <span>{line || ' '}</span>
                                    : <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />}
                            </span>
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    );
};

export default CodePanel;
