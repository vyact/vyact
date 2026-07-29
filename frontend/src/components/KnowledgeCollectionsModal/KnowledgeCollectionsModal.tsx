import {useEffect, useState} from 'react';
import {ArrowLeft, BookOpen, FileText, FilePlus2, Mail, Pencil, StickyNote, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
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
}

const KnowledgeCollectionsModal = ({isOpen, collections, onClose, onCreate, onUpdate, onDelete}: Props) => {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState<KnowledgeCollection | 'new' | null>(null);
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [instruction, setInstruction] = useState('');
    const [browsing, setBrowsing] = useState<KnowledgeCollection | null>(null);
    const [resolvedItems, setResolvedItems] = useState<Array<{source_type: 'document' | 'memo' | 'email_thread'; source_id: string; title: string; summary: string; updated_at: string; chunk_count?: number; content_html?: string; content?: string; message_count?: number}>>([]);
    const [selectedItemId, setSelectedItemId] = useState('');

    useEffect(() => { if (!isOpen) setEditing(null); }, [isOpen]);
    useEffect(() => { if (!browsing) return; api.getKnowledgeCollectionItems(browsing.id).then(result => { setResolvedItems(result.items); setSelectedItemId(result.items[0]?.source_id || ''); }).catch(() => setResolvedItems([])); }, [browsing]);
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

    return <ModalOverlay className="system-prompt-overlay" onClose={onClose} closeOnBackdrop closeOnEscape={!editing}>
        <div className="system-prompt-modal knowledge-collections-modal" onClick={event => event.stopPropagation()}>
            <div className="system-prompt-header"><div><div className="system-prompt-eyebrow">{t('knowledgeCollections.title')}</div><h2>{t('knowledgeCollections.title')}</h2><p>{t('knowledgeCollections.subtitle')}</p></div><button className="system-prompt-close" onClick={() => editing ? setEditing(null) : onClose()} aria-label={t('knowledgeCollections.close')}><X size={22}/></button></div>
            {browsing ? <div className="knowledge-collection-browser"><header className="knowledge-collection-browser-header"><button onClick={() => setBrowsing(null)}><ArrowLeft size={17}/>{t('knowledgeCollections.back')}</button><strong>{browsing.name}</strong></header><div className="knowledge-collection-browser-body"><aside>{resolvedItems.map(item => <button key={item.source_id} className={selectedItemId === item.source_id ? 'selected' : ''} onClick={() => setSelectedItemId(item.source_id)}>{item.source_type === 'document' ? <FileText size={16}/> : item.source_type === 'memo' ? <StickyNote size={16}/> : <Mail size={16}/>}<span><b>{item.title}</b><small>{t(`knowledgeCollections.type.${item.source_type}`)}</small></span><button aria-label={t('knowledgeCollections.removeItem')} onClick={event => { event.stopPropagation(); void removeItem(item); }}><Trash2 size={15}/></button></button>)}</aside><section>{selectedItem ? <><div className="knowledge-collection-source-heading"><span>{t(`knowledgeCollections.type.${selectedItem.source_type}`)}</span><h3>{selectedItem.title}</h3></div>{selectedItem.source_type === 'memo' ? <div className="knowledge-collection-memo-content" dangerouslySetInnerHTML={{__html: selectedItem.content_html || ''}}/> : selectedItem.source_type === 'email_thread' ? <pre className="knowledge-collection-email-content">{selectedItem.content}</pre> : <DocumentSourcePreview sourceId={selectedItem.source_id}/>}</> : <div className="knowledge-collection-browser-empty">{t('knowledgeCollections.selectItem')}</div>}</section></div></div> : !editing ? <div className="system-prompt-body knowledge-collections-list-view">
                <section className="system-saved-section"><div className="knowledge-collections-list-header"><div className="system-section-heading"><BookOpen size={18}/><span>{t('knowledgeCollections.title')}</span></div><button className="knowledge-collections-create-button" onClick={() => begin('new')}><FilePlus2 size={18}/>{t('knowledgeCollections.create')}</button></div>
                <div className="system-prompt-list">
                    {collections.length === 0 ? <div className="system-prompt-empty">{t('knowledgeCollections.empty')}</div> : collections.map(collection => { const documentCount = collection.items.filter(item => item.source_type === 'document').length; const memoCount = collection.items.filter(item => item.source_type === 'memo').length; return <div className="system-prompt-item" key={collection.id}><button className="system-prompt-info" onClick={() => setBrowsing(collection)}><span className="system-prompt-item-title">{collection.name}</span><span className="system-prompt-preview">{collection.description || t('knowledgeCollections.noDescription')} · {t('knowledgeCollections.sources', {documents: documentCount, memos: memoCount})}</span></button><button className="system-prompt-edit" aria-label={t('knowledgeCollections.edit')} onClick={() => begin(collection)}><Pencil size={16}/></button><button className="system-prompt-delete" aria-label={t('knowledgeCollections.delete')} onClick={() => void onDelete(collection.id)}><Trash2 size={16}/></button></div>; })}
                </div></section>
            </div> : <div className="system-prompt-body knowledge-collections-edit-view"><div className="system-prompt-editor knowledge-collections-editor">
                <div className="system-editor-heading"><FilePlus2 size={17}/><span>{editing === 'new' ? t('knowledgeCollections.create') : t('knowledgeCollections.edit')}</span></div>
                <label>{t('knowledgeCollections.name')}<input className="system-editor-title" autoFocus value={name} onChange={event => setName(event.target.value)} placeholder={t('knowledgeCollections.namePlaceholder')}/></label>
                <label>{t('knowledgeCollections.description')}<input className="system-editor-title" value={description} onChange={event => setDescription(event.target.value)} placeholder={t('knowledgeCollections.descriptionPlaceholder')}/></label>
                <label>{t('knowledgeCollections.instruction')}<textarea className="system-editor-content" value={instruction} onChange={event => setInstruction(event.target.value)} placeholder={t('knowledgeCollections.instructionPlaceholder')} rows={6}/></label>
                <div className="system-editor-actions knowledge-collections-editor-actions"><button className="system-cancel" onClick={() => setEditing(null)}>{t('knowledgeCollections.cancel')}</button><button className="system-save" onClick={() => void save()}>{t('knowledgeCollections.save')}</button></div>
            </div></div>}
        </div>
    </ModalOverlay>;
};

const DocumentSourcePreview = ({sourceId}: {sourceId: string}) => {
    const {t} = useTranslation('main');
    const [chunks, setChunks] = useState<Array<{chunk_index: number; content: string}>>([]);
    const [selectedChunkIndex, setSelectedChunkIndex] = useState<number | null>(null);
    useEffect(() => { fetch(`/api/document/files/${encodeURIComponent(sourceId)}/chunks`).then(response => response.json()).then(result => { setChunks(result.chunks || []); setSelectedChunkIndex(result.chunks?.[0]?.chunk_index ?? null); }).catch(() => setChunks([])); }, [sourceId]);
    const chunk = chunks.find(item => item.chunk_index === selectedChunkIndex);
    return <div className="knowledge-collection-document-preview"><nav>{chunks.map(item => <button key={item.chunk_index} className={item.chunk_index === selectedChunkIndex ? 'selected' : ''} onClick={() => setSelectedChunkIndex(item.chunk_index)}>#{item.chunk_index + 1} {item.content.slice(0, 80)}</button>)}</nav><article>{chunk?.content || t('knowledgeCollections.selectItem')}</article></div>;
};

export default KnowledgeCollectionsModal;
