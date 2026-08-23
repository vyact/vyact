import {useState} from 'react';
import {BookOpen, Check, ChevronRight, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {KnowledgeCollection, KnowledgeCollectionItem} from '../../types';
import {api} from '../../services/api';
import {getCachedKnowledgeCollections, updateCachedKnowledgeCollections} from '../../services/knowledgeCollectionsCache';
import {OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT} from '../../constants/ui';
import ActionMenu from '../common/ActionMenu/ActionMenu';
import './KnowledgeCollectionAttachSelect.css';

type Props = {source: KnowledgeCollectionItem; prepareSource?: () => Promise<KnowledgeCollectionItem>; onOpen?: () => void; onActionChange?: (action: 'add' | 'remove' | null) => void; onCreateCollection?: () => void; onSelectionComplete?: () => void; menuItem?: boolean};

const KnowledgeCollectionAttachSelect = ({source, prepareSource, onOpen, onActionChange, onCreateCollection, onSelectionComplete, menuItem = false}: Props) => {
    const {t} = useTranslation('main');
    const [collections, setCollections] = useState<KnowledgeCollection[]>(getCachedKnowledgeCollections);
    const [busy, setBusy] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const attach = async (collectionId: string) => {
        const collection = collections.find(item => item.id === collectionId);
        if (!collection || busy) return;
        const attached = collection.items.some(candidate => candidate.source_type === source.source_type && candidate.source_id === source.source_id);
        setBusy(true);
        onActionChange?.(attached ? 'remove' : 'add');
        try {
            if (attached) {
                const result = await api.removeKnowledgeCollectionItem(collection.id, source.source_type, source.source_id);
                updateCachedKnowledgeCollections(items => items.map(candidate => candidate.id === collection.id ? {...candidate, items: result.items} : candidate));
            } else {
                const item = prepareSource ? await prepareSource() : source;
                const updated = await api.updateKnowledgeCollection(collection.id, {...collection, items: [...collection.items, item]});
                updateCachedKnowledgeCollections(items => items.map(candidate => candidate.id === updated.id ? updated : candidate));
            }
            setCollections(getCachedKnowledgeCollections());
            setIsOpen(false);
            onSelectionComplete?.();
        } finally {
            setBusy(false);
            onActionChange?.(null);
        }
    };
    const openCollectionManager = () => {
        onCreateCollection?.();
        window.dispatchEvent(new Event(OPEN_KNOWLEDGE_COLLECTIONS_MODAL_EVENT));
    };
    return <ActionMenu className={`knowledge-collection-attach-select${menuItem ? ' knowledge-collection-attach-select--menu-item' : ''}`} isOpen={isOpen} onOpenChange={open => { setIsOpen(open); if (open) { onOpen?.(); setCollections(getCachedKnowledgeCollections()); } }} disabled={busy} ariaLabel={t('knowledgeCollections.title')} triggerClassName="knowledge-collection-attach-trigger" menuClassName="knowledge-collection-attach-menu" preferredSide={menuItem ? 'right' : 'bottom'} openOnHover={menuItem} trigger={menuItem ? <><BookOpen size={16}/><span>{t('knowledgeCollections.title')}</span><ChevronRight className="knowledge-collection-attach-chevron" size={15}/></> : <BookOpen size={18}/>}>{collections.length ? collections.map(collection => { const attached = collection.items.some(item => item.source_type === source.source_type && item.source_id === source.source_id); return <button type="button" key={collection.id} className="knowledge-collection-attach-option" onClick={() => void attach(collection.id)}><span>{collection.name}</span>{attached ? <Check className="knowledge-collection-attach-check" size={16}/> : <Plus size={16}/>}</button>; }) : <button type="button" className="knowledge-collection-create-action" onClick={openCollectionManager}><Plus size={16}/>{t('knowledgeCollections.create')}</button>}</ActionMenu>
};

export default KnowledgeCollectionAttachSelect;
