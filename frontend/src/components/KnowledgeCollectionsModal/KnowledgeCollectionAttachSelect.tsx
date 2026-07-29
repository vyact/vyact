import {useEffect, useState} from 'react';
import {BookOpen, Check, Plus} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {KnowledgeCollection, KnowledgeCollectionItem} from '../../types';
import {api} from '../../services/api';
import CustomSelect from '../CustomSelect/CustomSelect';
import './KnowledgeCollectionAttachSelect.css';

type Props = {source: KnowledgeCollectionItem; prepareSource?: () => Promise<KnowledgeCollectionItem>};

const KnowledgeCollectionAttachSelect = ({source, prepareSource}: Props) => {
    const {t} = useTranslation('main');
    const [collections, setCollections] = useState<KnowledgeCollection[]>([]);
    const [busy, setBusy] = useState(false);
    const loadCollections = () => api.getKnowledgeCollections().then(result => setCollections(result.collections || [])).catch(() => setCollections([]));
    useEffect(() => { void loadCollections(); }, []);
    const attach = async (collectionId: string) => {
        const collection = collections.find(item => item.id === collectionId);
        if (!collection || busy) return;
        setBusy(true);
        try {
            const item = prepareSource ? await prepareSource() : source;
            const attached = collection.items.some(candidate => candidate.source_type === item.source_type && candidate.source_id === item.source_id);
            if (attached) {
                const result = await api.removeKnowledgeCollectionItem(collection.id, item.source_type, item.source_id);
                setCollections(items => items.map(candidate => candidate.id === collection.id ? {...candidate, items: result.items} : candidate));
            } else {
                const updated = await api.updateKnowledgeCollection(collection.id, {...collection, items: [...collection.items, item]});
                setCollections(items => items.map(candidate => candidate.id === updated.id ? updated : candidate));
            }
        } finally { setBusy(false); }
    };
    return <CustomSelect className="knowledge-collection-attach-select" options={collections.map(collection => ({value: collection.id, label: collection.name}))} value="" onChange={value => void attach(value)} disabled={busy} alignRight placeholder={t('knowledgeCollectionSources.attachSources')} ariaLabel={t('knowledgeCollections.title')} onOpen={() => void loadCollections()} renderTrigger={() => <BookOpen size={18}/>} renderOption={option => { const collection = collections.find(item => item.id === option.value)!; const attached = collection.items.some(item => item.source_type === source.source_type && item.source_id === source.source_id); return <><span className="custom-select-item-label">{collection.name}</span>{attached ? <Check className="knowledge-collection-attach-check" size={16}/> : <Plus size={16}/>}</>; }}/>
};

export default KnowledgeCollectionAttachSelect;
