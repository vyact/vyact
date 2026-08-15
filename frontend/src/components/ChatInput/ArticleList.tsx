import React from 'react';
import { XCircle } from 'lucide-react';
import type { ArticleAttachment } from '../../types';
import './ArticleList.css';

interface ArticleListProps {
    articles: ArticleAttachment[];
    onRemove: (url: string) => void;
    onRemoveAll: () => void;
}

const ArticleList: React.FC<ArticleListProps> = ({ articles, onRemove, onRemoveAll }) => {
    if (articles.length === 0) return null;

    const isDoc = (url: string) => url?.startsWith('manual://') || url?.startsWith('file://');

    return (
        <div className="article-list">
            <div className="article-list-header">
                <span className="article-list-count">첨부 {articles.length}개</span>
                <button
                    className="article-list-remove-all"
                    onClick={onRemoveAll}
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
                <div className="article-list-item" key={art.url}>
                    {isDoc(art.url) ? (
                        <svg className="article-list-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
                            <polyline points="14 2 14 8 20 8"/>
                            <line x1="16" y1="13" x2="8" y2="13"/>
                            <line x1="16" y1="17" x2="8" y2="17"/>
                        </svg>
                    ) : (
                        <svg className="article-list-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2">
                            <path d="M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2Zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2"/>
                            <path d="M18 14h-8M15 18h-5M10 6h8v4h-8V6z"/>
                        </svg>
                    )}

                    {art.url && !isDoc(art.url) ? (
                        <a className="article-list-title link" href={art.url} target="_blank" rel="noreferrer">{art.title}</a>
                    ) : (
                        <span className="article-list-title">{art.title}</span>
                    )}

                    <button className="article-list-remove" onClick={() => onRemove(art.url)}>
                        <XCircle size={18} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default ArticleList;
