import {useEffect, useState} from 'react';
import {BookOpen, Check, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {KnowledgeCollection, KnowledgeCollectionItem} from '../../types';
import {api} from '../../services/api';
import {KNOWLEDGE_COLLECTIONS_UPDATED_EVENT, OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT} from '../../constants/ui';
import CustomSelect from '../CustomSelect/CustomSelect';
import './KnowledgeCollectionAttachSelect.css';

type Props = {source: KnowledgeCollectionItem; prepareSource?: () => Promise<KnowledgeCollectionItem>; onOpen?: () => void; onActionChange?: (action: 'add' | 'remove' | null) => void; onCreateCollection?: () => void};

const KnowledgeCollectionAttachSelect = ({source, prepareSource, onOpen, onActionChange, onCreateCollection}: Props) => {
    const {t} = useTranslation('main');
    const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
    const [busy, setBusy] = useState(false);
    const loadCollections = () => api.getKnowledgeCollections().then(result => setCollections(result.collections || [])).catch(() => setCollections([]));
    useEffect(() => { void loadCollections(); }, []);
    const attach = async (collectionId: string) => {
        const collection = collections.find(item => item.id === collectionId);
        if (!collection || busy) return;
        const attached = collection.items.some(candidate => candidate.source_type === source.source_type && candidate.source_id === source.source_id);
        setBusy(true);
        onActionChange?.(attached ? 'remove' : 'add');
        try {
            if (attached) {
                const result = await api.removeKnowledgeCollectionItem(collection.id, source.source_type, source.source_id);
                setCollections(items => items.map(candidate => candidate.id === collection.id ? {...candidate, items: result.items} : candidate));
            } else {
                const item = prepareSource ? await prepareSource() : source;
                const updated = await api.updateKnowledgeCollection(collection.id, {...collection, items: [...collection.items, item]});
                setCollections(items => items.map(candidate => candidate.id === updated.id ? updated : candidate));
            }
            window.dispatchEvent(new Event(KNOWLEDGE_COLLECTIONS_UPDATED_EVENT));
        } finally {
            setBusy(false);
            onActionChange?.(null);
        }
    };
    const openCollectionManager = () => {
        onCreateCollection?.();
        window.dispatchEvent(new Event(OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT));
    };
    return <CustomSelect className="knowledge-collection-attach-select" options={collections.map(collection => ({value: collection.id, label: collection.name}))} value="" onChange={value => void attach(value)} disabled={busy} alignRight placeholder={t('knowledgeCollectionSources.attachSources')} ariaLabel={t('knowledgeCollections.title')} onOpen={() => { onOpen?.(); void loadCollections(); }} emptyState={<button type="button" className="knowledge-collection-create-action" onClick={openCollectionManager}><Plus size={16}/>{t('knowledgeCollections.create')}</button>} renderTrigger={() => <BookOpen size={18}/>} renderOption={option => { const collection = collections.find(item => item.id === option.value)!; const attached = collection.items.some(item => item.source_type === source.source_type && item.source_id === source.source_id); return <><span className="custom-select-item-label">{collection.name}</span>{attached ? <Check className="knowledge-collection-attach-check" size={16}/> : <Plus size={16}/>}</>; }}/>
};

export default KnowledgeCollectionAttachSelect;
