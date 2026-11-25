import type {MarketSummaryAttachmentAction} from '../common/CommunityChat/CommunityChat';
import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {Newspaper} from 'lucide-react';
import {getStockNews, type StockNewsArticle} from '../../services/stockNews';
import StockLoadingIndicator from './StockLoadingIndicator';
import StockChatAttachmentButton from './StockChatAttachmentButton';
import './StockNews.css';

export default function StockNews({symbol, attachment}: {symbol: string; attachment?: MarketSummaryAttachmentAction['attachNews']}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`stockAnalysis.news.${key}`);
    const [articles, setArticles] = useState<StockNewsArticle[] | null>(null);
    const [error, setError] = useState(false);
    const [retry, setRetry] = useState(0);
    useEffect(() => {
        const controller = new AbortController();
        getStockNews(symbol, controller.signal).then(rows => {
            if (!controller.signal.aborted) setArticles(rows);
        }).catch(() => {if (!controller.signal.aborted) setError(true);});
        return () => controller.abort();
    }, [symbol, retry]);
    const dateFormat = new Intl.DateTimeFormat(i18n.resolvedLanguage, {dateStyle: 'medium', timeStyle: 'short'});
    return <section className="stock-news" aria-label={tr('tab')} aria-busy={!articles && !error}>
        <div className="stock-analysis-chart-stage stock-news-body">
        {!articles && !error && <StockLoadingIndicator title={tr('tab')} iconOnly/>}
        {error && <div className="stock-news-error"><p role="alert">{tr('error')}</p><button type="button" className="modal-action-cancel" onClick={() => {setError(false); setArticles(null); setRetry(value => value + 1);}}>{t('stockAnalysis.retry')}</button></div>}
        {articles?.length === 0 && <div className="stock-news-empty" role="status">
            <span className="stock-news-empty-icon"><Newspaper size={28} strokeWidth={1.5} aria-hidden="true"/></span>
            <p>{tr('empty')}</p>
        </div>}
        {!!articles?.length && <ul>{articles.map(article => {
            const timestamp = article.publishedAt ? new Date(article.publishedAt) : null;
            return <li key={article.url}>
                <div className="stock-news-heading">
                    <a href={article.url} target="_blank" rel="noopener noreferrer">{article.title}</a>
                    {attachment && <StockChatAttachmentButton label={t('documentModal.attachToChat')}
                        disabled={attachment.disabled || attachment.attachedUrls.has(URL.parse(article.url)?.href ?? article.url)} capturing={false} onClick={() => attachment.add({
                            ...article,
                            title: article.title.slice(0, 500),
                            publisher: article.publisher.slice(0, 160),
                            summary: article.summary.slice(0, 1000),
                        })}/>}
                </div>
                <div className="stock-news-meta"><span>{article.publisher}</span>{timestamp && Number.isFinite(timestamp.getTime()) && <time dateTime={article.publishedAt!}>{dateFormat.format(timestamp)}</time>}</div>
                {article.summary && <p>{article.summary}</p>}
            </li>;
        })}</ul>}
        </div>
        <footer className="stock-news-note">{tr('source')}</footer>
    </section>;
}
