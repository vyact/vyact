import {useEffect, useState} from 'react';
import {ArrowLeft, BookOpen, FileText, FilePlus2, Mail, Pencil, StickyNote, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import {MemoViewer} from '../MemoModal/MemoModal';
import type {KnowledgeCollection} from '../../types';
import {api} from '../../services/api';
import '../SystemPromptModal/SystemPromptModal.css';
import './KnowledgeCollectionsModal.css';

interface Props {
    isOpen: boolean;
    collections: KnowledgeCollection[];
    onClose: () => void;
    onCreate: (data: Pick<KnowledgeCollection, 'name' | 'description' | 'instruction' | 'items'>) => Promise<void>;
    onUpdate: (id: string, data: Pick<KnowledgeCollection, 'name' | 'description' | 'instruction' | 'items'>) => Promise<void>;
    onDelete: (id: string) => Promise<void>;
    onReorder: (collectionIds: string[]) => Promise<void>;
}

type CollectionSourceType = KnowledgeCollection['items'][number]['source_type'];
const sourceLabel = (t: (key: string, options?: Record<string, unknown>) => string, type: CollectionSourceType) => t(`knowledgeCollectionSources.${type}`);

const KnowledgeCollectionsModal = ({isOpen, collections, onClose, onCreate, onUpdate, onDelete, onReorder}: Props) => {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState<KnowledgeCollection | 'new' | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [instruction, setInstruction] = useState('');
    const [browsing, setBrowsing] = useState<KnowledgeCollection | null>(null);
    const [resolvedItems, setResolvedItems] = useState<Array<{source_type: 'document' | 'memo' | 'email_thread'; source_id: string; title: string; summary: string; updated_at: string; chunk_count?: number; content_html?: string; content?: string; messages?: Array<{id: string; from: string; to: string; cc?: string; date: string; subject: string; body: string; html_body?: string}>; message_count?: number}>>([]);
    const [selectedItemId, setSelectedItemId] = useState('');
    const [draggedCollectionId, setDraggedCollectionId] = useState<string | null>(null);
    const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);

    useEffect(() => { if (!isOpen) { setEditing(null); setBrowsing(null); } }, [isOpen]);
    useEffect(() => {
        if (!isOpen || !browsing) return;
        const handleEscape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return;
            event.preventDefault();
            event.stopPropagation();
            setBrowsing(null);
        };
        document.addEventListener('keydown', handleEscape, true);
        return () => document.removeEventListener('keydown', handleEscape, true);
    }, [isOpen, browsing]);
    useEffect(() => {
        if (!browsing) return;
        const loadItems = async () => {
            try {
                const result = await api.getKnowledgeCollectionItems(browsing.id);
                const items = result.items || [];
                if (items.length || browsing.items.length === 0) {
                    setResolvedItems(items);
                    setSelectedItemId(items[0]?.source_id || '');
                    return;
                }
                const [filesResult, memosResult] = await Promise.all([
                    fetch('/api/document/files').then(response => response.json()).catch(() => ({files: []})),
                    api.listMemos(200).catch(() => ({memos: []})),
                ]);
                const files = new Map<string, {file_id: string; filename: string; indexed_at?: string; chunk_count?: number}>(
                    (filesResult.files || []).map((file: {file_id: string; filename: string; indexed_at?: string; chunk_count?: number}) => [file.file_id, file]),
                );
                const memos = new Map<string, {id: string; title?: string; content?: string; updated_at?: string}>(
                    (memosResult.memos || []).map((memo: {id: string; title?: string; content?: string; updated_at?: string}) => [memo.id, memo]),
                );
                const fallbackItems = browsing.items.map(item => {
                    const file = item.source_type === 'document' ? files.get(item.source_id) : undefined;
                    const memo = item.source_type === 'memo' ? memos.get(item.source_id) : undefined;
                    return {source_type: item.source_type, source_id: item.source_id, title: file?.filename || memo?.title || item.source_id, summary: memo?.content || '', updated_at: file?.indexed_at || memo?.updated_at || '', chunk_count: file?.chunk_count};
                });
                setResolvedItems(fallbackItems);
                setSelectedItemId(fallbackItems[0]?.source_id || '');
            } catch { setResolvedItems([]); }
        };
        void loadItems();
    }, [browsing]);
    if (!isOpen) return null;

    const begin = (collection: KnowledgeCollection | 'new') => {
        setEditing(collection);
        setName(collection === 'new' ? '' : collection.name);
        setDescription(collection === 'new' ? '' : collection.description || '');
        setInstruction(collection === 'new' ? '' : collection.instruction || '');
    };
    const save = async () => {
        if (!editing || !name.trim()) return;
        const data = {name: name.trim(), description: description.trim(), instruction: instruction.trim(), items: editing === 'new' ? [] : editing.items};
        if (editing === 'new') await onCreate(data); else await onUpdate(editing.id, data);
        setEditing(null);
    };
    const selectedItem = resolvedItems.find(item => item.source_id === selectedItemId);
    const removeItem = async (item: typeof resolvedItems[number]) => {
        if (!browsing) return;
        await api.removeKnowledgeCollectionItem(browsing.id, item.source_type, item.source_id);
        setResolvedItems(items => items.filter(candidate => candidate.source_id !== item.source_id));
        setSelectedItemId(current => current === item.source_id ? '' : current);
    };
    const reorderCollections = async (targetCollectionId: string) => {
        if (!draggedCollectionId || draggedCollectionId === targetCollectionId) return;
        const sourceIndex = collections.findIndex(collection => collection.id === draggedCollectionId);
        const targetIndex = collections.findIndex(collection => collection.id === targetCollectionId);
        if (sourceIndex < 0 || targetIndex < 0) return;
        const reorderedCollections = [...collections];
        const [movedCollection] = reorderedCollections.splice(sourceIndex, 1);
        reorderedCollections.splice(targetIndex, 0, movedCollection);
        try {
            await onReorder(reorderedCollections.map(collection => collection.id));
        } finally {
            setDraggedCollectionId(null);
            setDragOverCollectionId(null);
        }
    };


    return <ModalOverlay className="system-prompt-overlay" onClose={onClose} closeOnBackdrop closeOnEscape={!editing && !browsing}>
        <div className="system-prompt-modal knowledge-collections-modal" onClick={event => event.stopPropagation()}>
            <div className="system-prompt-header"><div><div className="system-prompt-eyebrow">{t('knowledgeCollections.title')}</div><h2>{t('knowledgeCollections.title')}</h2><p>{t('knowledgeCollections.subtitle')}</p></div><button className="system-prompt-close" onClick={() => editing ? setEditing(null) : browsing ? setBrowsing(null) : onClose()} aria-label={t('knowledgeCollections.close')}><X size={22}/></button></div>
            {browsing ? <div className="knowledge-collection-browser"><header className="knowledge-collection-browser-header"><button onClick={() => setBrowsing(null)}><ArrowLeft size={17}/>{t('knowledgeCollectionSources.back')}</button><strong>{browsing.name}</strong></header><div className="knowledge-collection-browser-body"><aside>{resolvedItems.map(item => <div key={`${item.source_type}:${item.source_id}`} className={`knowledge-collection-browser-item${selectedItemId === item.source_id ? ' selected' : ''}`}><button className="knowledge-collection-browser-item-select" onClick={() => setSelectedItemId(item.source_id)}>{item.source_type === 'document' ? <FileText size={16}/> : item.source_type === 'memo' ? <StickyNote size={16}/> : <Mail size={16}/>}<span><b>{item.title}</b><small className={item.source_type === 'document' && item.chunk_count !== undefined ? 'knowledge-collection-source-meta' : ''}>{sourceLabel(t, item.source_type)}{item.source_type === 'document' && item.chunk_count !== undefined && <em className="knowledge-collection-chunk-count">{t('documentModal.chunkCount', {count: item.chunk_count})}</em>}</small></span></button><button className="knowledge-collection-browser-item-remove" aria-label={t('knowledgeCollectionSources.removeItem')} onClick={() => void removeItem(item)}><Trash2 size={15}/></button></div>)}</aside><section className={selectedItem?.source_type === 'document' ? 'knowledge-collection-browser-document-section' : selectedItem?.source_type === 'memo' ? 'knowledge-collection-browser-memo-section' : selectedItem?.source_type === 'email_thread' ? 'knowledge-collection-browser-email-section' : ''}>{selectedItem ? <>{selectedItem.source_type === 'memo' ? <MemoViewer memoId={selectedItem.source_id}/> : selectedItem.source_type === 'email_thread' ? <EmailThreadPreview item={selectedItem}/> : <DocumentSourcePreview sourceId={selectedItem.source_id}/>}</> : <div className="knowledge-collection-browser-empty">{t('knowledgeCollectionSources.selectItem')}</div>}</section></div></div> : !editing ? <div className="system-prompt-body knowledge-collections-list-view">
                <section className="system-saved-section"><div className="knowledge-collections-list-header"><div className="system-section-heading"><BookOpen size={18}/><span>{t('knowledgeCollections.title')}</span></div><button className="knowledge-collections-create-button" onClick={() => begin('new')}><FilePlus2 size={18}/>{t('knowledgeCollections.create')}</button></div>
                <div className="system-prompt-list">
                    {collections.length === 0 ? <div className="system-prompt-empty">{t('knowledgeCollections.empty')}</div> : collections.map(collection => { const documentCount = collection.items.filter(item => item.source_type === 'document').length; const memoCount = collection.items.filter(item => item.source_type === 'memo').length; const emailCount = collection.items.filter(item => item.source_type === 'email_thread').length; const openCollection = () => setBrowsing(collection); return <div className={`system-prompt-item knowledge-collection-row${draggedCollectionId === collection.id ? ' dragging' : ''}${dragOverCollectionId === collection.id ? ' drag-over' : ''}`} key={collection.id} role="button" tabIndex={0} draggable onDragStart={() => setDraggedCollectionId(collection.id)} onDragOver={event => { event.preventDefault(); if (collection.id !== draggedCollectionId) setDragOverCollectionId(collection.id); }} onDragLeave={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragOverCollectionId(current => current === collection.id ? null : current); }} onDrop={() => void reorderCollections(collection.id)} onDragEnd={() => { setDraggedCollectionId(null); setDragOverCollectionId(null); }} onClick={openCollection} onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openCollection(); } }}><button className="system-prompt-info" onClick={openCollection}><span className="system-prompt-item-title">{collection.name}</span><span className="system-prompt-preview">{collection.description || t('knowledgeCollections.noDescription')} · {sourceLabel(t, 'document')} {documentCount} · {sourceLabel(t, 'memo')} {memoCount} · {sourceLabel(t, 'email_thread')} {emailCount}</span></button><button className="system-prompt-edit" aria-label={t('knowledgeCollections.edit')} onClick={event => { event.stopPropagation(); begin(collection); }}><Pencil size={16}/></button><button className="system-prompt-delete" aria-label={t('knowledgeCollections.delete')} onClick={event => { event.stopPropagation(); void onDelete(collection.id); }}><Trash2 size={16}/></button></div>; })}
                </div></section>
            </div> : <div className="system-prompt-body knowledge-collections-edit-view"><div className="system-prompt-editor knowledge-collections-editor">
                <div className="system-editor-heading"><FilePlus2 size={17}/><span>{editing === 'new' ? t('knowledgeCollections.create') : t('knowledgeCollections.edit')}</span></div>
                <label>{t('knowledgeCollections.name')}<input className="system-editor-title" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('knowledgeCollections.namePlaceholder')}/></label>
                <label>{t('knowledgeCollections.description')}<input className="system-editor-title" value={description} onChange={event => setDescription(event.target.value)} placeholder={t('knowledgeCollections.descriptionPlaceholder')}/></label>
                <label className="knowledge-collections-instruction-field">{t('knowledgeCollections.instruction')}<textarea className="system-editor-content" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t('knowledgeCollections.instructionPlaceholder')} rows={6}/></label>
                <div className="system-editor-actions knowledge-collections-editor-actions"><button className="system-cancel" onClick={() => setEditing(null)}>{t('knowledgeCollections.cancel')}</button><button className="system-save" onClick={() => void save()} disabled={!name.trim()}>{t('knowledgeCollections.save')}</button></div>
            </div></div>}
        </div>
    </ModalOverlay>;
};


const DocumentSourcePreview = ({sourceId}: {sourceId: string}) => {
    const {t} = useTranslation('main');
    const [chunks, setChunks] = useState<Array<{chunk_index: number; content: string}>>([]);
    const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(null);
    useEffect(() => { fetch(`/api/document/files/${encodeURIComponent(sourceId)}/chunks`).then(response => response.json()).then(result => { setChunks(result.chunks || []); setSelectedChunkIndex(null); }).catch(() => setChunks([])); }, [sourceId]);
    const chunk = chunks.find(item => item.chunk_index === selectedChunkIndex);
    return <div className="knowledge-collection-document-preview"><nav>{chunks.map(item => <button key={item.chunk_index} className={item.chunk_index === selectedChunkIndex ? 'selected' : ''} onClick={() => setSelectedChunkIndex(item.chunk_index)}>#{item.chunk_index + 1} {item.content.slice(0, 80)}</button>)}</nav><article className={chunk ? '' : 'empty'}>{chunk?.content || t('knowledgeCollectionSources.selectItem')}</article></div>;
};

const EmailThreadPreview = ({item}: {item: {title: string; content?: string; messages?: Array<{id: string; from: string; to: string; cc?: string; date: string; subject: string; body: string; html_body?: string}>}}) => {
    const {t} = useTranslation('main');
    if (!item.messages?.length) return <pre className="knowledge-collection-email-content">{item.content}</pre>;
    return <div className="knowledge-collection-email-thread">
        {item.messages.map((message, index) => <article className="knowledge-collection-email-message" key={message.id || index}>
            <header>
                <div className="knowledge-collection-email-avatar" aria-label={`${index + 1}`}>{index + 1}</div>
                <div className="knowledge-collection-email-sender"><strong>{message.from || t('googleWorkspace.sender')}</strong><span>{message.date}</span></div>
            </header>
            <dl className="knowledge-collection-email-meta">
                <div><dt>{t('googleWorkspace.recipient')}</dt><dd>{message.to}</dd></div>
                {message.cc && <div><dt>{t('googleWorkspace.cc')}</dt><dd>{message.cc}</dd></div>}
                {message.subject && <div><dt>{t('googleWorkspace.subject')}</dt><dd>{message.subject}</dd></div>}
            </dl>
            {message.html_body ? <EmailHtmlBody html={message.html_body}/> : <div className="knowledge-collection-email-body">{message.body}</div>}
        </article>)}
    </div>;
};

const EmailHtmlBody = ({html}: {html: string}) => {
    const resize = (iframe: HTMLIFrameElement) => {
        const document = iframe.contentDocument;
        if (document) iframe.style.height = `${Math.max(document.documentElement.scrollHeight, document.body.scrollHeight)}px`;
    };
    return <iframe className="knowledge-collection-email-html" sandbox="allow-popups allow-same-origin" scrolling="no" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src http: https: data: blob:; style-src 'unsafe-inline';"><base target="_blank"><style>html,body{margin:0;max-width:100%;background:#fff;color:#1f1f1f}body{padding:14px;box-sizing:border-box;overflow-wrap:anywhere;font-family:Pretendard,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;font-size:12px;line-height:1.65}img{max-width:100%!important;height:auto!important}table{max-width:100%!important}</style></head><body>${html}</body></html>`} onLoad={event => { resize(event.currentTarget); event.currentTarget.contentDocument?.querySelectorAll('img').forEach(image => image.addEventListener('load', () => resize(event.currentTarget), {once: true})); }}/>
};

export default KnowledgeCollectionsModal;
