import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import hljs from '../../utils/syntaxHighlighter';
import 'highlight.js/styles/github-dark.css';
import { renderMarkdown } from '../../utils/markdownUtils';
import { cleanNewsText } from '../../utils/helpers';
import { getLocalizedSourceLabel } from '../../utils/sourceLabels';
import './RagContextModal.css';

interface InjectedContextItem {
    source: string;
    title?: string;
    data: string;
    context_origin?: 'external_data';
}

interface RagContextModalProps {
    items: InjectedContextItem[];
    onClose: () => void;
    kind?: 'injected' | 'external';
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

function formatPublicDataText(text: string): string {
    return text
        .replace(/\r\n?/g, '\n')
        .replace(/[ \t]+/g, ' ')
        .replace(/ *\n */g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

const RagContextModal: React.FC<RagContextModalProps> = ({ items, onClose, kind = 'injected' }) => {
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
    const isPublicData = activeItem?.source === 'Government24';
    const content = (isCode || isMarkdown)
        ? rawData
        : isPublicData
            ? formatPublicDataText(rawData)
            : cleanNewsText(rawData);

    return (
        <div className="rag-context-overlay">
            <div
                onClick={(e: React.MouseEvent) => e.stopPropagation()}
                className="rag-context-modal"
            >
                {/* 헤더 */}
                <div className="rag-context-header">
                    <div className="rag-context-header-title">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
                             stroke="var(--accent, #e07050)" strokeWidth="2">
                            <circle cx="11" cy="11" r="8"/>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                        </svg>
                        <span className="rag-context-title">
                            {t(kind === 'external' ? 'message.externalDataTitle' : 'message.injectedDataTitle')}
                        </span>
                        <span className="rag-context-count">{t('message.count', { count: items.length })}</span>
                    </div>
                    <button className="rag-context-close" onClick={onClose}>×</button>
                </div>

                <div className="rag-context-layout">
                    {/* 탭 사이드바 */}
                    {items.length > 1 && (
                        <div className="rag-context-tabs">
                            {items.map((item, idx) => (
                                <button key={idx} onClick={() => setActiveIdx(idx)} className={`rag-context-tab${activeIdx === idx ? ' active' : ''}`}>
                                    {item.title || item.source}
                                </button>
                            ))}
                        </div>
                    )}

                    {/* 내용 */}
                    <div className="rag-context-content">
                        <div className="rag-context-item-title">
                            {activeItem?.title || activeItem?.source}
                        </div>
                        {activeItem?.title && (
                            <div className="rag-context-source">
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
                                    className="markdown-body rag-context-markdown"
                                    dangerouslySetInnerHTML={{ __html: mdHtml }}
                                />
                            );
                        })() : isCode ? (
                            <div className="rag-context-code-block">
                                {lang && (
                                    <div className="rag-context-code-language">
                                        {lang}
                                    </div>
                                )}
                                <pre
                                    className={`hljs rag-context-code${lang ? ' has-language' : ''}`}
                                >
                                    <code
                                        dangerouslySetInnerHTML={{ __html: highlightedHtml }}
                                        className="rag-context-code-content"
                                    />
                                </pre>
                            </div>
                        ) : isPublicData ? (
                            <div className="rag-context-public-data">
                                {content.split(/\n{2,}/).filter(Boolean).map((paragraph, index) => (
                                    <p key={index}>
                                        {paragraph}
                                    </p>
                                ))}
                            </div>
                        ) : (
                            <pre className="rag-context-plain-text">
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
