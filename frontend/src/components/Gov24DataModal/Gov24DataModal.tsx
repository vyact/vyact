import React, {useEffect, useRef, useState} from 'react';
import {CalendarClock, Check, ExternalLink, FileText, Landmark, Plus, Search, Tag, Users, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import type {Gov24Document} from '../../services/api';
import type {ExternalDocumentSelection} from '../../services/externalDocumentSelections';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import './Gov24DataModal.css';

interface Gov24DataModalProps {
    isOpen: boolean;
    onClose: () => void;
    sourceId?: string;
    sourceNameKey?: string;
    sources?: ReadonlyArray<{id: string; nameKey: string}>;
    selectedDocuments?: ExternalDocumentSelection[];
    onToggleDocument?: (document: ExternalDocumentSelection) => void;
    providedDocuments?: ReadonlyArray<{
        document: Gov24Document;
        sourceId: string;
        sourceNameKey: string;
    }>;
}

type BrowserDocument = Gov24Document & {
    browserKey: string;
    browserSourceId: string;
    browserSourceNameKey: string;
};

const isDisplayCategory = (value: string | undefined) => Boolean(value && !/^[a-z][a-z0-9_]*_tab\d+$/i.test(value));

const ALL_EXTERNAL_CURSOR_KEY = 'all';

const Gov24DataModal: React.FC<Gov24DataModalProps> = ({isOpen, onClose, sourceId = 'kr.gov24', sourceNameKey = 'gov24', sources, selectedDocuments = [], onToggleDocument, providedDocuments}) => {
    const {t, i18n} = useTranslation('settings');
    const [searchQuery, setSearchQuery] = useState('');
    const [debouncedQuery, setDebouncedQuery] = useState('');
    const [documents, setDocuments] = useState<BrowserDocument[]>([]);
    const [selectedId, setSelectedId] = useState('');
    const [total, setTotal] = useState(0);
    const [nextCursors, setNextCursors] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [error, setError] = useState(false);
    const requestIdRef = useRef(0);
    const detailScrollRef = useRef<HTMLDivElement>(null);
    const sourceConfigs = sources?.length ? sources : [{id: sourceId, nameKey: sourceNameKey}];
    const sourceConfigKey = sourceConfigs.map(source => `${source.id}:${source.nameKey}`).join('|');
    const isAllSources = Boolean(sources?.length);
    const isProvidedData = Boolean(providedDocuments);
    const attachSource = (items: Gov24Document[], source: {id: string; nameKey: string}): BrowserDocument[] => items.map(document => ({
        ...document,
        browserKey: `${source.id}:${document.id}`,
        browserSourceId: source.id,
        browserSourceNameKey: source.nameKey,
    }));
    const attachAllSources = (items: Array<Gov24Document & {source_id: string}>): BrowserDocument[] => items.map(document => {
        const source = sourceConfigs.find(item => item.id === document.source_id) || {id: document.source_id, nameKey: 'gov24'};
        return {
            ...document,
            browserKey: `${source.id}:${document.id}`,
            browserSourceId: source.id,
            browserSourceNameKey: source.nameKey,
        };
    });

    useEffect(() => {
        const timeoutId = window.setTimeout(() => setDebouncedQuery(searchQuery), 250);
        return () => window.clearTimeout(timeoutId);
    }, [searchQuery]);

    useEffect(() => {
        if (!isOpen) return;
        const requestId = ++requestIdRef.current;
        queueMicrotask(() => {
            if (requestId !== requestIdRef.current) return;
            if (providedDocuments) {
                const normalizedQuery = debouncedQuery.trim().toLocaleLowerCase();
                const provided = providedDocuments
                    .filter(({document}) => !normalizedQuery || [document.title, document.agency, document.target, document.content]
                        .some(value => value?.toLocaleLowerCase().includes(normalizedQuery)))
                    .map(({document, sourceId: documentSourceId, sourceNameKey: documentSourceNameKey}) => ({
                        ...document,
                        browserKey: `${documentSourceId}:${document.id}`,
                        browserSourceId: documentSourceId,
                        browserSourceNameKey: documentSourceNameKey,
                    }));
                setDocuments(provided);
                setTotal(provided.length);
                setNextCursors({});
                setSelectedId(current => provided.some(document => document.browserKey === current)
                    ? current : provided[0]?.browserKey || '');
                setLoading(false);
                setError(false);
                return;
            }
            setLoading(true);
            setError(false);
            const source = sourceConfigs[0];
            const request = isAllSources
                ? api.getAllExternalDocuments(debouncedQuery).then(result => ({
                    documents: attachAllSources(result.items),
                    total: result.total,
                    cursors: result.next_cursor ? {[ALL_EXTERNAL_CURSOR_KEY]: result.next_cursor} : {} as Record<string, string>,
                }))
                : api.getExternalSourceDocuments(source.id, debouncedQuery).then(result => ({
                    documents: attachSource(result.items, source),
                    total: result.total,
                    cursors: result.next_cursor ? {[source.id]: result.next_cursor} : {} as Record<string, string>,
                }));
            void request.then(result => {
                if (requestId !== requestIdRef.current) return;
                setDocuments(result.documents);
                setTotal(result.total);
                setNextCursors(result.cursors);
                setSelectedId(result.documents[0]?.browserKey || '');
            }).catch(() => {
                if (requestId === requestIdRef.current) setError(true);
            }).finally(() => {
                if (requestId === requestIdRef.current) setLoading(false);
            });
        });
        return () => {
            if (requestId === requestIdRef.current) requestIdRef.current += 1;
        };
    }, [debouncedQuery, isOpen, sourceConfigKey, providedDocuments]);

    useEffect(() => {
        if (detailScrollRef.current) detailScrollRef.current.scrollTop = 0;
    }, [selectedId]);

    if (!isOpen) return null;

    const isSelectedDocument = (document: BrowserDocument) => selectedDocuments.some(selection =>
        selection.source_id === document.browserSourceId && selection.document_id === document.id,
    );
    const toggleDocument = (document: BrowserDocument) => onToggleDocument?.({
        source_id: document.browserSourceId,
        document_id: document.id,
        title: document.title,
    });
    const selectedDocument = documents.find(document => document.browserKey === selectedId) || documents[0];
    const isDocumentAttached = selectedDocument ? isSelectedDocument(selectedDocument) : false;
    const detailBadges = selectedDocument
        ? [isDisplayCategory(selectedDocument.category) ? selectedDocument.category : '', selectedDocument.support_type]
            .map(value => value?.trim())
            .filter((value, index, values): value is string => Boolean(value) && values.indexOf(value) === index)
        : [];
    const numberFormatter = new Intl.NumberFormat(i18n.resolvedLanguage || i18n.language);
    const formatDate = (value: string) => {
        const parsed = new Date(value);
        if (Number.isNaN(parsed.getTime())) return value;
        return new Intl.DateTimeFormat(i18n.resolvedLanguage || i18n.language, {dateStyle: 'medium'}).format(parsed);
    };
    const getDocumentDate = (document: BrowserDocument) => {
        if (document.application_end_date) {
            return {kind: 'deadline', label: t('externalData.browser.deadlineAt', {date: formatDate(document.application_end_date)})};
        }
        if (document.browserSourceId === 'kr.k_startup' && document.record_type === 'business' && document.source_modified_at) {
            return {kind: 'year', label: t('externalData.browser.businessYearAt', {year: document.source_modified_at})};
        }
        if (document.source_modified_at) {
            return {kind: 'modified', label: t('externalData.browser.modifiedAt', {date: formatDate(document.source_modified_at)})};
        }
        return {kind: 'unknown', label: t('externalData.browser.unknownDate')};
    };
    const loadMore = async () => {
        if (isProvidedData) return;
        if (isAllSources) {
            const cursor = nextCursors[ALL_EXTERNAL_CURSOR_KEY];
            if (!cursor || loadingMore) return;
            setLoadingMore(true);
            try {
                const result = await api.getAllExternalDocuments(debouncedQuery, cursor);
                setDocuments(current => [...current, ...attachAllSources(result.items)]);
                setNextCursors(result.next_cursor ? {[ALL_EXTERNAL_CURSOR_KEY]: result.next_cursor} : {});
            } catch {
                setError(true);
            } finally {
                setLoadingMore(false);
            }
            return;
        }
        const sourcesToLoad = sourceConfigs.filter(source => nextCursors[source.id]);
        if (!sourcesToLoad.length || loadingMore) return;
        setLoadingMore(true);
        try {
            const results = await Promise.allSettled(sourcesToLoad.map(async source => ({source, result: await api.getExternalSourceDocuments(source.id, debouncedQuery, nextCursors[source.id])})));
            const loadedResults = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : []);
            setDocuments(current => [...current, ...loadedResults.flatMap(({source, result}) => attachSource(result.items, source))]);
            setNextCursors(current => {
                const next = {...current};
                loadedResults.forEach(({source, result}) => {
                    if (result.next_cursor) next[source.id] = result.next_cursor;
                    else delete next[source.id];
                });
                return next;
            });
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
                    <h2 id="gov24-browser-title">{isAllSources || isProvidedData ? t('externalData.title') : t(`externalData.sources.${sourceNameKey}.name`)}</h2>
                    <button type="button" onClick={onClose} aria-label={t('externalData.browser.close')}><X size={20}/></button>
                </header>
                {!isProvidedData && <div className="gov24-browser-toolbar">
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
                            placeholder={t('common:search')}
                            aria-label={t('externalData.browser.searchPlaceholder')}
                            autoFocus
                        />
                        {searchQuery && <button type="button" onClick={() => setSearchQuery('')} aria-label={t('externalData.browser.clearSearch')}><X size={15}/></button>}
                    </label>
                    <span>{t('externalData.browser.resultCount', {count: numberFormatter.format(total)})}</span>
                </div>}
                <div className="gov24-browser-body">
                    <aside className="gov24-browser-list" onScroll={event => {
                        if (isProvidedData) return;
                        const element = event.currentTarget;
                        if (element.scrollHeight - element.scrollTop - element.clientHeight < 160) void loadMore();
                    }}>
                        {loading ? <div className="gov24-browser-state">{t('externalData.browser.loading')}</div>
                            : error && !documents.length ? <div className="gov24-browser-state is-error">{t('externalData.browser.loadFailed')}</div>
                                : !documents.length ? <div className="gov24-browser-state">{t('externalData.browser.empty')}</div>
                                    : documents.map(document => {
                                        const documentDate = getDocumentDate(document);
                                        const isAttached = isSelectedDocument(document);
                                        return <div key={document.browserKey} className={`gov24-browser-list-row${document.browserKey === selectedDocument?.browserKey ? ' is-selected' : ''}`}>
                                            <button type="button" className="gov24-browser-list-select" onClick={() => setSelectedId(document.browserKey)}>
                                                <strong>{document.title}</strong>
                                                <span className="gov24-browser-list-meta">
                                                    <time className={`gov24-browser-date is-${documentDate.kind}`}>{documentDate.label}</time>
                                                    <span>{isAllSources || isProvidedData ? t(`externalData.sources.${document.browserSourceNameKey}.name`) : document.agency || t('externalData.browser.unknownAgency')}</span>
                                                </span>
                                            </button>
                                            {onToggleDocument && <button type="button" className={`gov24-browser-list-attach${isAttached ? ' is-attached' : ''}`} onClick={() => toggleDocument(document)}>
                                                {isAttached ? t('externalData.removeSelectedDocument') : t('externalData.addSelectedDocument')}
                                            </button>}
                                        </div>;
                                    })}
                        {!isProvidedData && loadingMore && <div className="gov24-browser-loading-more">{t('externalData.browser.loadingMore')}</div>}
                    </aside>
                    <main className="gov24-browser-detail">
                        {selectedDocument ? <>
                            <div className="gov24-browser-detail-hero">
                                <div className="gov24-browser-detail-title-row">
                                    <div className="gov24-browser-detail-copy">
                                        <div className="gov24-browser-detail-heading">
                                            <div className="gov24-browser-detail-badges">
                                                {detailBadges.map((badge, index) => <span key={badge}>{index === 0 && <Tag size={13}/>} {badge}</span>)}
                                            </div>
                                            <h2>{selectedDocument.title}</h2>
                                        </div>
                                        {selectedDocument.browserSourceId !== 'kr.biz_support' && selectedDocument.browserSourceId !== 'kr.k_startup' && selectedDocument.summary && <p>{selectedDocument.summary}</p>}
                                    </div>
                                    <div className="gov24-browser-side-meta">
                                        {selectedDocument.agency && <span className="gov24-browser-agency"><Landmark size={15}/>{selectedDocument.agency}</span>}
                                        <div className="gov24-browser-side-actions">
                                            <span className={`gov24-browser-date is-${getDocumentDate(selectedDocument).kind}`}><CalendarClock size={15}/>{getDocumentDate(selectedDocument).label}</span>
                                            {onToggleDocument && <button type="button" className={`gov24-browser-attach${isDocumentAttached ? ' is-attached' : ''}`} onClick={() => toggleDocument(selectedDocument)}>
                                                {isDocumentAttached ? <Check size={15}/> : <Plus size={15}/>} 
                                                {t(isDocumentAttached ? 'externalData.removeSelectedDocument' : 'externalData.addSelectedDocument')}
                                            </button>}
                                        </div>
                                    </div>
                                </div>
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
