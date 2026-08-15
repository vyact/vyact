import React, { useState, useMemo } from 'react';
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
    const { panel, setActiveIdx, closePanel } = useCodePanel();
    const [copiedPanel, setCopiedPanel] = useState<typeof panel>(null);

    const activeFile = panel ? panel.files[panel.activeIdx] : null;

    const lines = useMemo(() => {
        if (!activeFile) return [];
        return highlightCode(activeFile.code, activeFile.lang);
    }, [activeFile]);

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
                        <span className="cp-meta">{extLabel} <i /> {lineCount} lines</span>
                    </div>
                </div>
                <div className="cp-actions">
                    <button
                        className={`cp-btn${copied ? ' cp-btn--copied' : ''}`}
                        onClick={handleCopy}
                        aria-label={copied ? '복사됨' : '코드 복사'}
                    >
                        {copied ? (
                            <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                                    <polyline points="20 6 9 17 4 12"/>
                                </svg>
                                복사됨
                            </>
                        ) : (
                            <>
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                                     stroke="currentColor" strokeWidth="2" aria-hidden="true">
                                    <rect x="9" y="9" width="13" height="13" rx="2"/>
                                    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                                </svg>
                                복사
                            </>
                        )}
                    </button>
                    <button
                        className="cp-btn"
                        onClick={() => downloadFile(activeFile)}
                        aria-label="다운로드"
                    >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                            <polyline points="7 10 12 15 17 10"/>
                            <line x1="12" y1="15" x2="12" y2="3"/>
                        </svg>
                        <span className="cp-btn-label">다운로드</span>
                    </button>
                    <button
                        className="cp-close"
                        onClick={closePanel}
                        aria-label="패널 닫기"
                    >
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                             stroke="currentColor" strokeWidth="2" aria-hidden="true">
                            <line x1="18" y1="6" x2="6" y2="18"/>
                            <line x1="6" y1="6" x2="18" y2="18"/>
                        </svg>
                    </button>
                </div>
            </div>

            {/* 파일 탭 (2개 이상일 때) */}
            {panel.files.length > 1 && (
                <div className="cp-tabs">
                    {panel.files.map((f, i) => (
                        <button
                            key={i}
                            className={`cp-tab${panel.activeIdx === i ? ' cp-tab--active' : ''}`}
                            onClick={() => setActiveIdx(i)}
                        >
                            <span className="cp-tab-name">{f.name}</span>
                            <span className="cp-tab-ext">{EXT_LABEL[f.lang.toLowerCase()] ?? f.lang.toUpperCase()}</span>
                        </button>
                    ))}
                </div>
            )}

            {/* 코드 영역 */}
            <div className="cp-code">
                <pre className="cp-pre hljs">
                    <code>
                        {lines.map((line, i) => (
                            <span key={i} className="cp-line">
                                <span className="cp-lineno" aria-hidden="true">{i + 1}</span>
                                <span dangerouslySetInnerHTML={{ __html: line || ' ' }} />
                            </span>
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    );
};

export default CodePanel;
