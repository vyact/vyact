import React from 'react';
import { XCircle } from 'lucide-react';
import type { ArticleAttachment } from '../../types';

interface ArticleListProps {
    articles: ArticleAttachment[];
    onRemove: (url: string) => void;
    onRemoveAll: () => void;
}

const ArticleList: React.FC<ArticleListProps> = ({ articles, onRemove, onRemoveAll }) => {
    if (articles.length === 0) return null;

    const isDoc = (url: string) => url?.startsWith('manual://') || url?.startsWith('file://');

    return (
        <div style={{ padding: '8px 12px 4px', display: 'flex', flexDirection: 'column', gap: '4px' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '2px' }}>
                <span style={{ fontSize: '13px', color: 'var(--muted)' }}>첨부 {articles.length}개</span>
                <button
                    onClick={onRemoveAll}
                    style={{
                        background: 'transparent',
                        border: '1px solid var(--del-border)',
                        borderRadius: '8px',
                        cursor: 'pointer',
                        fontSize: '13px',
                        color: 'var(--del-fg-soft)',
                        padding: '4px 8px',
                        display: 'flex', alignItems: 'center', gap: '4px',
                        transition: 'all 0.15s',
                    }}
                    onMouseEnter={e => {
                        e.currentTarget.style.background = 'var(--del-bg-hover)';
                        e.currentTarget.style.borderColor = 'var(--del-border-hover)';
                        e.currentTarget.style.color = 'var(--del-fg)';
                    }}
                    onMouseLeave={e => {
                        e.currentTarget.style.background = 'transparent';
                        e.currentTarget.style.borderColor = 'var(--del-border)';
                        e.currentTarget.style.color = 'var(--del-fg-soft)';
                    }}
                >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <polyline points="3 6 5 6 21 6"/>
                        <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
                        <path d="M10 11v6M14 11v6"/>
                        <path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
                    </svg>
                    전체 삭제
                </button>
            </div>

            {articles.map(art => (
                <div key={art.url} style={{
                    display: 'flex', alignItems: 'center', gap: '6px',
                    padding: '7px 10px', background: 'rgba(255,255,255,0.04)',
                    borderRadius: '6px', border: '1px solid var(--border)',
                }}>
                    {isDoc(art.url) ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                    ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2" style={{ flexShrink: 0 }}>
                            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
                            <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6z"/>
                        </svg>
                    )}

                    {art.url && !isDoc(art.url) ? (
                        <a href={art.url} target="_blank" rel="noreferrer" style={{
                            flex: 1, fontSize: '14px', color: 'var(--text)',
                            textDecoration: 'none', overflow: 'hidden',
                            textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}
                           onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                           onMouseLeave={e => (e.currentTarget.style.color = 'var(--text)')}
                        >{art.title}</a>
                    ) : (
                        <span style={{
                            flex: 1, fontSize: '14px', color: 'var(--text)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>{art.title}</span>
                    )}

                    <button onClick={() => onRemove(art.url)} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: '2px', display: 'flex', alignItems: 'center',
                        color: 'var(--del-border-hover)', flexShrink: 0,
                        transition: 'color 0.15s',
                    }}
                            onMouseEnter={e => (e.currentTarget.style.color = 'var(--del-fg)')}
                            onMouseLeave={e => (e.currentTarget.style.color = 'var(--del-border-hover)')}
                    >
                        <XCircle size={18} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ArticleList;