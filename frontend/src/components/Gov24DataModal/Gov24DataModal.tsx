import React, {useEffect, useRef, useState} from 'react';
import {CalendarClock, ExternalLink, FileText, Landmark, Search, Tag, Users, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import type {Gov24Document} from '../../services/api';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './Gov24DataModal.css';

interface Gov24DataModalProps {
    isOpen: boolean;
    onClose: () => void;
    sourceId?: string;
    sourceNameKey?: string;
}

const Gov24DataModal: React.FC<Gov24DataModalProps> = ({isOpen, onClose, sourceId = 'kr.gov24', sourceNameKey = 'gov24'}) => {
    const {t, i18n} = useTranslation('settings');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [documents, setDocuments] = useState<Gov24Document[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [total, setTotal] = useState(0);
    const [nextCursor, setNextCursor] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(false);
    const requestIdRef = useRef(0);
    const detailScrollRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebouncedQuery(searchQuery), 250);
        return () => window.clearTimeout(timeoutId);
    }, [searchQuery]);

    useEffect(() => {
        if (!isOpen) return;
        const requestId = ++requestIdRef.current;
        queueMicrotask(() => {
            if (requestId !== requestIdRef.current) return;
            setLoading(true);
            setError(false);
            void api.getExternalSourceDocuments(sourceId, debouncedQuery).then(result => {
                if (requestId !== requestIdRef.current) return;
                setDocuments(result.items);
                setTotal(result.total);
                setNextCursor(result.next_cursor);
                setSelectedId(result.items[0]?.id || '');
            }).catch(() => {
                if (requestId === requestIdRef.current) setError(true);
            }).finally(() => {
                if (requestId === requestIdRef.current) setLoading(false);
            });
        });
        return () => {
            if (requestId === requestIdRef.current) requestIdRef.current += 1;
        };
    }, [debouncedQuery, isOpen, sourceId]);

    useEffect(() => {
        if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    }, [selectedId]);

    if (!isOpen) return null;

    const selectedDocument = documents.find(document => document.id === selectedId) || documents[0];
    const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);
    const formatModifiedAt = (value: string) => {
        if (!value) return t('externalData.browser.unknownDate');
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {dateStyle: 'medium'}).format(parsed);
    };
    const loadMore = async () => {
        if (!nextCursor || loadingMore) return;
        setLoadingMore(true);
        try {
            const result = await api.getExternalSourceDocuments(sourceId, debouncedQuery, nextCursor);
            setDocuments(current => [...current, ...result.items]);
            setNextCursor(result.next_cursor);
        } catch {
            setError(true);
        } finally {
            setLoadingMore(false);
        }
    };
    const renderSection = (title: string, value: string) => value ? (
        <section className="gov24-browser-detail-section">
            <h3>{title}</h3>
            <p>{value}</p>
        </section>
    ) : null;

    return (
        <ModalOverlay className="gov24-browser-overlay" onClose={onClose} closeOnBackdrop={false} blur={3}>
            <div className="gov24-browser-modal" aria-labelledby="gov24-browser-title">
                <header className="gov24-browser-header">
                    <h2 id="gov24-browser-title">{t(`externalData.sources.${sourceNameKey}.name`)}</h2>
                    <button type="button" onClick={onClose} aria-label={t('externalData.browser.close')}><X size={20}/></button>
                </header>
                <div className="gov24-browser-toolbar">
                    <label className="gov24-browser-search">
                        <Search size={17}/>
                        <input
                            value={searchQuery}
                            onChange={event => setSearchQuery(event.target.value)}
                            onKeyDown={event => {
                                if (event.key !== 'Escape') return;
                                event.preventDefault();
                                event.stopPropagation();
                                event.nativeEvent.stopImmediatePropagation();
                                // 현재 keydown 전파가 완전히 끝난 뒤 자식 모달을 제거해야
                                // 같은 Escape가 부모 설정 모달의 닫기로 이어지지 않는다.
                                window.setTimeout(onClose, 0);
                            }}
                            placeholder={t('externalData.browser.searchPlaceholder')}
                            autoFocus
                        />
                        {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label={t('externalData.browser.clearSearch')}><X size={15}/></button>}
                    </label>
                    <span>{t('externalData.browser.resultCount', {count: numberFormatter.format(total)})}</span>
                </div>
                <div className="gov24-browser-body">
                    <aside className="gov24-browser-list" onScroll={event => {
                        const element = event.currentTarget;
                        if (element.scrollHeight - element.scrollTop - element.clientHeight < 160) void loadMore();
                    }}>
                        {loading ? <div className="gov24-browser-state">{t('externalData.browser.loading')}</div>
                            : error && !documents.length ? <div className="gov24-browser-state is-error">{t('externalData.browser.loadFailed')}</div>
                                : !documents.length ? <div className="gov24-browser-state">{t('externalData.browser.empty')}</div>
                                    : documents.map(document => (
                                        <button type="button" key={document.id} className={document.id === selectedDocument?.id ? 'is-selected' : ''} onClick={() => setSelectedId(document.id)}>
                                            <strong>{document.title}</strong>
                                            <span className="gov24-browser-list-meta">
                                                <time>{formatModifiedAt(document.source_modified_at)}</time>
                                                <span>{document.agency || t('externalData.browser.unknownAgency')}</span>
                                            </span>
                                        </button>
                                    ))}
                        {loadingMore && <div className="gov24-browser-loading-more">{t('externalData.browser.loadingMore')}</div>}
                    </aside>
                    <main className="gov24-browser-detail">
                        {selectedDocument ? <>
                            <div className="gov24-browser-detail-hero">
                                <div className="gov24-browser-detail-title-row">
                                    <div className="gov24-browser-detail-badges">
                                        {selectedDocument.category && <span><Tag size={13}/>{selectedDocument.category}</span>}
                                        {selectedDocument.support_type && <span>{selectedDocument.support_type}</span>}
                                    </div>
                                    <h2>{selectedDocument.title}</h2>
                                    <div className="gov24-browser-meta">
                                        {selectedDocument.agency && <span><Landmark size={15}/>{selectedDocument.agency}</span>}
                                        <span><CalendarClock size={15}/>{formatModifiedAt(selectedDocument.source_modified_at)}</span>
                                    </div>
                                </div>
                                {sourceId !== 'kr.biz_support' && sourceId !== 'kr.k_startup' && selectedDocument.summary && <p>{selectedDocument.summary}</p>}
                            </div>
                            <div ref={detailScrollRef} className="gov24-browser-detail-scroll">
                                {(selectedDocument.target || selectedDocument.user_type) && <div className="gov24-browser-info-card">
                                    <Users size={19}/><div><strong>{t('externalData.browser.target')}</strong><p>{[selectedDocument.target, selectedDocument.user_type].filter(Boolean).join(' · ')}</p></div>
                                </div>}
                                {selectedDocument.application_deadline && <div className="gov24-browser-info-card"><CalendarClock size={19}/><div><strong>{t('externalData.browser.deadline')}</strong><p>{selectedDocument.application_deadline}</p></div></div>}
                                {renderSection(t('externalData.browser.purpose'), selectedDocument.purpose)}
                                {renderSection(t('externalData.browser.content'), selectedDocument.content)}
                                {renderSection(t('externalData.browser.selectionCriteria'), selectedDocument.selection_criteria)}
                                {renderSection(t('externalData.browser.applicationMethod'), selectedDocument.application_method)}
                                {renderSection(t('externalData.browser.requiredDocuments'), selectedDocument.required_documents)}
                                {!!selectedDocument.attachments?.length && <section className="gov24-browser-detail-section">
                                    <h3>{t('externalData.browser.requiredDocuments')}</h3>
                                    <div className="gov24-browser-attachments">{selectedDocument.attachments.map(attachment => <a key={`${attachment.name}-${attachment.url}`} href={attachment.url} target="_blank" rel="noreferrer"><FileText size={15}/><span>{attachment.name}</span><ExternalLink size={12}/></a>)}</div>
                                </section>}
                                {renderSection(t('externalData.browser.contact'), selectedDocument.contact)}
                                {selectedDocument.source_url && <a className="gov24-browser-source-link" href={selectedDocument.source_url} target="_blank" rel="noreferrer"><FileText size={17}/>{t('externalData.openSourcePage')}<ExternalLink size={14}/></a>}
                            </div>
                        </> : <div className="gov24-browser-detail-empty"><FileText size={32}/><p>{t('externalData.browser.selectDocument')}</p></div>}
                    </main>
                </div>
            </div>
        </ModalOverlay>
    );
};

export default Gov24DataModal;
