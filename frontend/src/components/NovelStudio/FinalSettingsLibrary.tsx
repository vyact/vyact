import {useState} from 'react';
import {ChevronDown, Eye, Trash2} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import type {FinalSetting} from './storyStorage';

interface Props {
    items: FinalSetting[];
    activeId: string | null;
    disabled: boolean;
    onSelect: (id: string) => void;
    onView: (id: string) => void;
    onChange: (items: FinalSetting[]) => void;
}
export default function FinalSettingsLibrary({items, activeId, disabled, onSelect, onView, onChange}: Props) {
    const {t} = useTranslation('main');
    const tr = (key: string) => t(`novelStudio.${key}`);
    const [expanded, setExpanded] = useState(false);
    const [deleting, setDeleting] = useState<FinalSetting | null>(null);
    return <section className="novel-candidate-group novel-final-library">
        <header><button className="novel-group-toggle" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}><span className="novel-group-label"><h3>{tr('finalSettings')}</h3><span>{items.find(item => item.id === activeId)?.title || tr('noFinalSetting')}</span></span><span className="novel-group-count">{items.length}</span><ChevronDown className={expanded ? 'is-open' : ''} size={15}/></button></header>
        {expanded && <div className="novel-group-candidates">{!items.length && <p className="novel-final-empty">{tr('finalEmpty')}</p>}{items.map(item => <article className="novel-candidate" key={item.id}><div className="novel-candidate-title"><input type="radio" name="novel-final-setting" checked={activeId === item.id} disabled={disabled} aria-label={t('novelStudio.useFinalSetting', {title: item.title})} onChange={() => onSelect(item.id)}/><input aria-label={tr('candidateTitle')} value={item.title} maxLength={200} disabled={disabled} onChange={event => onChange(items.map(current => current.id === item.id ? {...current, title: event.target.value} : current))}/><button className="titlebar-btn novel-candidate-open" disabled={disabled} aria-label={tr('viewShort')} onClick={() => onView(item.id)}><Eye size={15}/></button><button className="titlebar-btn novel-candidate-delete" disabled={disabled} aria-label={tr('delete')} onClick={() => setDeleting(item)}><Trash2 size={13}/></button></div></article>)}</div>}
        {deleting && <ConfirmModal title={tr('deleteFinalSetting')} description={deleting.title} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('delete'), value: 'delete', variant: 'danger'}]} onClose={() => setDeleting(null)} onSelect={value => {if (value === 'delete') onChange(items.filter(item => item.id !== deleting.id)); setDeleting(null);}}/>}
    </section>;
}
