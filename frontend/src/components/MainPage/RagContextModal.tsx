import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import hljs from 'highlight.js';
import 'highlight.js/styles/github-dark.css';
import { renderMarkdown } from '../../utils/markdownUtils';
import { cleanNewsText } from '../../utils/helpers';
import { getLocalizedSourceLabel } from '../../utils/sourceLabels';

interface InjectedContextItem {
    source: string;
    title?: string;
    data: string;
}

interface RagContextModalProps {
    items: InjectedContextItem[];
    onClose: () => void;
}

// source/title 문자열에서 언어를 추론 (파일명 확장자 or zip:xxx/yyy.js 패턴)
// "[1/1]" 같은 청크 표시를 먼저 제거한 뒤 확장자를 추출한다.
function detectLangFromSource(source: string): string | null {
    const clean = source.replace(/\s*\[\d+\/\d+\]\s*$/, ''); // "[1/1]" 등 청크 표시 제거
    const name = clean.split('/').pop() ?? clean;
    const ext = name.split('.').pop()?.toLowerCase() ?? '';
    const extMap: Record<string, string> = {
        js: 'javascript', ts: 'typescript', tsx: 'typescript', jsx: 'javascript',
        py: 'python', java: 'java', kt: 'kotlin', go: 'go',
        rs: 'rust', c: 'c', cpp: 'cpp', cs: 'csharp',
        html: 'html', css: 'css', scss: 'scss',
        json: 'json', yaml: 'yaml', yml: 'yaml',
        sh: 'bash', bash: 'bash', zsh: 'bash',
        md: 'markdown', sql: 'sql', xml: 'xml',
        toml: 'ini', env: 'bash',
    };
    return extMap[ext] ?? null;
}

// 내용이 코드처럼 보이는지 heuristic 판별
function looksLikeCode(text: string): boolean {
    const lines = text.split('\n').slice(0, 30);
    const codePatterns = [
        /^(import|export|const|let|var|function|class|def|async|await)\s/,
        /^\s*(if|for|while|return|try|catch|throw)\s*[{(]/,
        /[{};]\s*$/,
        /^\s{2,}[\w$"'`]/,
        /=>\s*[{(]/,
        /:\s*(string|number|boolean|void|any|dict|list)\b/,
    ];
    let hits = 0;
    for (const line of lines) {
        if (codePatterns.some(p => p.test(line))) hits++;
    }
    return hits >= 3;
}

const RagContextModal: React.FC<RagContextModalProps> = ({ items, onClose }) => {
    const { t } = useTranslation('main');
    const [activeIdx, setActiveIdx] = React.useState(0);

    React.useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [onClose]);

    const activeItem = items[activeIdx];

    const { isCode, isMarkdown, lang, highlightedHtml } = useMemo(() => {
        if (!activeItem) return { isCode: false, isMarkdown: false, lang: '', highlightedHtml: '' };
        const raw = activeItem.data ?? '';
        const detectedLang = detectLangFromSource(activeItem.title ?? '')
            ?? detectLangFromSource(activeItem.source ?? '');
        // 마크다운은 코드 하이라이팅이 아니라 renderMarkdown으로 별도 처리
        if (detectedLang === 'markdown') return { isCode: false, isMarkdown: true, lang: '', highlightedHtml: '' };
        const isCode = detectedLang ? true : looksLikeCode(raw);
        if (!isCode) return { isCode: false, isMarkdown: false, lang: '', highlightedHtml: '' };
        try {
            if (detectedLang && hljs.getLanguage(detectedLang)) {
                const result = hljs.highlight(raw, { language: detectedLang, ignoreIllegals: true });
                return { isCode: true, isMarkdown: false, lang: detectedLang, highlightedHtml: result.value };
            }
            const result = hljs.highlightAuto(raw);
            return { isCode: true, isMarkdown: false, lang: result.language ?? '', highlightedHtml: result.value };
        } catch {
            return { isCode: true, isMarkdown: false, lang: '', highlightedHtml: raw.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') };
        }
    }, [activeItem]);

    // 코드/마크다운은 raw 그대로, 일반 기사/텍스트는 cleanNewsText로 단락 정리
    // \n 이스케이프만 먼저 실제 줄바꿈으로 복원 (ES 저장 시 이스케이프된 경우 대비)
    const rawData = (activeItem?.data ?? '').replace(/\\n/g, '\n');
    const content = (isCode || isMarkdown) ? rawData : cleanNewsText(rawData);

    return (
        <div
            style={{
                position: 'fixed', inset: 0, zIndex: 9000,
                background: 'rgba(0,0,0,0.6)',
                display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
                paddingTop: '80px', paddingBottom: '40px', overflowY: 'auto',
            }}
        >
            <div
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                style={{
                    width: '680px', maxWidth: '90vw', maxHeight: '80vh',
                    background: 'var(--bg-secondary, #1e1e1e)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    borderRadius: '14px', display: 'flex', flexDirection: 'column',
                    overflow: 'hidden', boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
                }}
            >
                {/* 헤더 */}
                <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="var(--accent, #e07050)" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: 'var(--text)' }}>
                            {t('message.injectedDataTitle')}
                        </span>
                        <span style={{
                            fontSize: '11px', color: 'var(--muted)',
                            background: 'rgba(255,255,255,0.07)',
                            borderRadius: '10px', padding: '1px 8px',
                        }}>{t('message.count', { count: items.length })}</span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        color: 'var(--muted)', fontSize: '18px', lineHeight: 1,
                        padding: '2px 6px', borderRadius: '4px',
                    }}>×</button>
                </div>

                <div style={{ display: 'flex', flex: 1, overflow: 'hidden' }}>
                    {/* 탭 사이드바 */}
                    {items.length > 1 && (
                        <div style={{
                            width: '160px', flexShrink: 0,
                            borderRight: '1px solid rgba(255,255,255,0.08)',
                            overflowY: 'auto', padding: '8px 0',
                        }}>
                            {items.map((item, idx) => (
                                <button key={idx} onClick={() => setActiveIdx(idx)} style={{
                                    width: '100%', textAlign: 'left',
                                    padding: '8px 14px', border: 'none', cursor: 'pointer',
                                    background: activeIdx === idx
                                        ? 'rgba(255,255,255,0.08)' : 'none',
                                    borderLeft: activeIdx === idx
                                        ? '2px solid var(--accent, #e07050)' : '2px solid transparent',
                                    fontSize: '14px', color: activeIdx === idx
                                        ? 'var(--text)' : 'var(--muted)',
                                    transition: 'all 0.15s',
                                }}>
                                    {item.title || item.source}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 내용 */}
                    <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px' }}>
                        <div style={{
                            fontSize: '14px', fontWeight: 600,
                            color: 'var(--accent, #e07050)', marginBottom: '4px',
                        }}>
                            {activeItem?.title || activeItem?.source}
                        </div>
                        {activeItem?.title && (
                            <div style={{
                                fontSize: '12px', color: 'var(--muted)', marginBottom: '10px',
                            }}>
                                {t('message.source')}: {getLocalizedSourceLabel(activeItem?.source, t)}
                            </div>
                        )}

                        {isMarkdown ? (() => {
                            // renderMarkdown은 코드 펜스를 처리하지 않으므로 먼저 추출해
                            // hljs로 하이라이팅한 <pre> 블록으로 치환한 뒤 renderMarkdown에 넘긴다.
                            const codePlaceholders: string[] = [];
                            const preprocessed = content.replace(/^[ \t]*```([^\n`]*)\n([\s\S]*?)^[ \t]*```/gm, (_, langRaw: string, code: string) => {
                                const lang = langRaw.trim();
                                const trimmedCode = code.trim(); // 앞뒤 공백/줄바꿈 제거
                                let highlighted = trimmedCode.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                try {
                                    if (lang && hljs.getLanguage(lang)) {
                                        highlighted = hljs.highlight(trimmedCode, { language: lang, ignoreIllegals: true }).value;
                                    } else {
                                        highlighted = hljs.highlightAuto(trimmedCode).value;
                                    }
                                } catch {
                                    // Fall back to the escaped code when syntax highlighting is unavailable.
                                }
                                const label = lang
                                    ? `<div style="font-size:11px;color:var(--muted);font-family:monospace;padding:3px 10px;background:rgba(255,255,255,0.06);border-bottom:1px solid rgba(255,255,255,0.08);">${lang}</div>`
                                    : '';
                                const block = `<div style="margin:10px 0;border-radius:8px;border:1px solid rgba(255,255,255,0.08);overflow:hidden;">${label}<pre class="hljs" style="margin:0;padding:12px 14px;font-size:13px;line-height:1.55;white-space:pre-wrap;word-break:break-all;background:transparent;"><code>${highlighted}</code></pre></div>`;
                                const idx = codePlaceholders.length;
                                codePlaceholders.push(block);
                                return `XCODEBLOCK${idx}X`;
                            });
                            const mdHtml = renderMarkdown(preprocessed).replace(/XCODEBLOCK(\d+)X/g, (_, i) => codePlaceholders[Number(i)] ?? '');
                            return (
                                <div
                                    className="markdown-body"
                                    style={{ fontSize: '14px', lineHeight: '1.7', color: 'var(--text)', opacity: 0.9 }}
                                    dangerouslySetInnerHTML={{ __html: mdHtml }}
                                />
                            );
                        })() : isCode ? (
                            <div style={{
                                borderRadius: '8px',
                                border: '1px solid rgba(255,255,255,0.08)',
                                overflow: 'hidden',
                            }}>
                                {lang && (
                                    <div style={{
                                        padding: '4px 12px',
                                        background: 'rgba(255,255,255,0.06)',
                                        borderBottom: '1px solid rgba(255,255,255,0.08)',
                                        fontSize: '11px', color: 'var(--muted)',
                                        fontFamily: 'monospace',
                                    }}>
                                        {lang}
                                    </div>
                                )}
                                <pre
                                    className="hljs"
                                    style={{
                                        margin: 0, padding: '14px 16px',
                                        /* 가로 스크롤 대신 줄바꿈 — 뷰어 용도라 reformat이 더 읽기 편함 */
                                        overflowX: 'hidden',
                                        whiteSpace: 'pre-wrap',
                                        wordBreak: 'break-all',
                                        fontSize: '13px', lineHeight: '1.6',
                                        borderRadius: lang ? '0 0 8px 8px' : '8px',
                                        background: 'transparent',
                                    }}
                                >
                                    <code
                                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                                        style={{ background: 'none', padding: 0 }}
                                    />
                                </pre>
                            </div>
                        ) : (
                            <pre style={{
                                fontSize: '14px', color: 'var(--text)',
                                lineHeight: '1.7', whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word', margin: 0,
                                opacity: 0.85, fontFamily: 'inherit',
                            }}>
                                {content}
                            </pre>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default RagContextModal;
