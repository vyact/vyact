import React, {useState, useMemo} from 'react';
import hljs from '../../utils/syntaxHighlighter';
import 'highlight.js/styles/github-dark.css';
import {copyToClipboard} from '../../utils/helpers';
import './CodeBlock.css';

interface CodeBlockProps {
    code: string;
    language?: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({code, language = 'code'}) => {
    const [copied, setCopied] = useState(false);

    const highlighted = useMemo(() => {
        const trimmed = code.trim();
        let html: string;
        let lang: string;

        if (!language || language === 'code') {
            const result = hljs.highlightAuto(trimmed);
            html = result.value;
            lang = result.language ?? 'code';
        } else if (hljs.getLanguage(language)) {
            const result = hljs.highlight(trimmed, {language});
            html = result.value;
            lang = language;
        } else {
            const result = hljs.highlightAuto(trimmed);
            html = result.value;
            lang = result.language ?? language;
        }

        // 줄 단위로 분리해서 라인 번호 추가
        const lines = html.split('\n');
        // 마지막 빈 줄 제거
        if (lines[lines.length - 1] === '') lines.pop();

        return {lines, lang};
    }, [code, language]);

    const handleCopy = async () => {
        const success = await copyToClipboard(code);
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="code-block">
            <div className="code-block-header">
                <span className="code-lang">{highlighted.lang}</span>
                <button className={`copy-btn${copied ? ' copied' : ''}`} onClick={handleCopy}>
                    {copied ? (
                        <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2">
                                <polyline points="20 6 9 17 4 12"/>
                            </svg>
                            복사됨
                        </>
                    ) : (
                        <>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                                 strokeWidth="2">
                                <rect x="9" y="9" width="13" height="13" rx="2"/>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
                            </svg>
                            복사
                        </>
                    )}
                </button>
            </div>
            <div className="code-body">
                <pre className="hljs">
                    <code>
                        {highlighted.lines.map((line, i) => (
                            <span key={i} className="code-line">
                                <span className="line-number" aria-hidden="true">{i + 1}</span>
                                <span dangerouslySetInnerHTML={{__html: line || ' '}} />
                            </span>
                        ))}
                    </code>
                </pre>
            </div>
        </div>
    );
};

export default CodeBlock;
