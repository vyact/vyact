import {useEffect, useState} from 'react';
import {Check, Plus, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {KnowledgeCollection, KnowledgeCollectionItem} from '../../types';
import {api} from '../../services/api';
import {getCachedKnowledgeCollections, updateCachedKnowledgeCollections} from '../../services/knowledgeCollectionsCache';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import '../SystemPromptModal/SystemPromptModal.css';
import './KnowledgeCollectionAttachModal.css';

type Props = {
    isOpen: boolean;
    source: KnowledgeCollectionItem;
    onClose: () => void;
    prepareSource?: () => Promise<KnowledgeCollectionItem>;
};

const KnowledgeCollectionAttachModal = ({isOpen, source, onClose, prepareSource}: Props) => {
    const {t} = useTranslation('main');
    const [collections, setCollections] = useState<KnowledgeCollection[]>(getCachedKnowledgeCollections);
    const [busyId, setBusyId] = useState('');
    useEffect(() => { if (isOpen) setCollections(getCachedKnowledgeCollections()); }, [isOpen]);
    if (!isOpen) return null;
    const attach = async (collection: KnowledgeCollection) => {
        setBusyId(collection.id);
        try {
            const prepared = prepareSource ? await prepareSource() : source;
            const exists = collection.items.some(item => item.source_type === prepared.source_type && item.source_id === prepared.source_id);
            if (!exists) {
                const updated = await api.updateKnowledgeCollection(collection.id, {...collection, items: [...collection.items, prepared]});
                updateCachedKnowledgeCollections(items => items.map(item => item.id === updated.id ? updated : item));
                setCollections(getCachedKnowledgeCollections());
            }
        } finally { setBusyId(''); }
    };
    return <ModalOverlay className="system-prompt-overlay" onClose={onClose} closeOnBackdrop>
        <div className="system-prompt-modal knowledge-collection-attach-modal" onClick={event => event.stopPropagation()}>
            <div className="system-prompt-header"><div><div className="system-prompt-eyebrow">{t('knowledgeCollections.title')}</div><h2>{t('knowledgeCollectionSources.attachSources')}</h2><p>{t('knowledgeCollections.select')}</p></div><button className="system-prompt-close" onClick={onClose} aria-label={t('knowledgeCollections.close')}><X size={22}/></button></div>
            <div className="knowledge-collection-attach-list">{collections.length === 0 ? <div className="system-prompt-empty">{t('knowledgeCollections.empty')}</div> : collections.map(collection => { const attached = collection.items.some(item => item.source_type === source.source_type && item.source_id === source.source_id); return <button key={collection.id} disabled={Boolean(busyId)} onClick={() => void attach(collection)}><span><b>{collection.name}</b><small>{collection.description || t('knowledgeCollections.noDescription')}</small></span>{attached ? <Check size={18}/> : <Plus size={18}/>}</button>; })}</div>
        </div>
    </ModalOverlay>;
};

export default KnowledgeCollectionAttachModal;
