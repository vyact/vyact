import {useState, type ReactNode} from 'react';
import {Check, Plus, Sparkles, Trash2, ChevronDown} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {SETTING_CATEGORIES, type SettingCandidate, type SettingCategory} from './storyStorage';

interface SettingsPlannerProps {
    candidates: SettingCandidate[];
    disabled: boolean;
    onChange: (candidates: SettingCandidate[]) => void;
    onChoose: (category: SettingCategory) => void;
    onSynthesize: () => void;
    children: ReactNode;
    activeCategory?: SettingCategory;
}

export default function SettingsPlanner({candidates, disabled, onChange, onChoose, onSynthesize, children, activeCategory}: SettingsPlannerProps) {
    const {t} = useTranslation('main');
    const tr = (key: string) => t(`novelStudio.${key}`);
    const [expanded, setExpanded] = useState<Set<SettingCategory>>(() => new Set(activeCategory ? [activeCategory] : []));
    const [deleting, setDeleting] = useState<SettingCandidate | null>(null);
    const update = (id: string, patch: Partial<SettingCandidate>) => onChange(candidates.map(candidate => candidate.id === id ? {...candidate, ...patch} : candidate));
    const selectedCount = candidates.filter(candidate => candidate.selected).length;
    return <div className="novel-settings-planner">
        <div className="novel-settings-intro"><span className="novel-step">01</span><div><h2>{tr('collectSettings')}</h2><p>{tr('collectHelp')}</p></div></div>
        <div className="novel-candidate-groups">{SETTING_CATEGORIES.map((category, index) => {
            const items = candidates.filter(candidate => candidate.category === category);
            return <section className="novel-candidate-group" key={category}>
                <header><button className="novel-group-toggle" aria-expanded={expanded.has(category)} onClick={() => setExpanded(previous => {const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next;})}>
                    <span className="novel-category-order">{String(index + 1).padStart(2, '0')}</span><span className="novel-group-label"><h3>{tr(category)}</h3><span>{tr(`${category}Hint`)}</span></span><span className="novel-group-count">{items.length}</span><ChevronDown className={expanded.has(category) ? 'is-open' : ''} size={15}/></button><button className="titlebar-btn" disabled={disabled} aria-label={t('novelStudio.addCandidate', {category: tr(category)})} onClick={() => onChoose(category)}><Plus size={15}/></button></header>
                {expanded.has(category) && <div className="novel-group-candidates">
                {!items.length && <button className="novel-candidate-empty" disabled={disabled} onClick={() => onChoose(category)}><Plus size={15}/>{tr('candidateEmpty')}</button>}
                {items.map(candidate => <article className={`novel-candidate${candidate.selected ? ' is-selected' : ''}`} key={candidate.id}>
                    <div className="novel-candidate-title"><input type="checkbox" checked={candidate.selected} disabled={disabled} aria-label={t('novelStudio.selectCandidate', {title: candidate.title})} onChange={event => update(candidate.id, {selected: event.target.checked})}/><input aria-label={tr('candidateTitle')} maxLength={200} disabled={disabled} value={candidate.title} onChange={event => update(candidate.id, {title: event.target.value})}/><button className="titlebar-btn" disabled={disabled} aria-label={tr('delete')} onClick={() => setDeleting(candidate)}><Trash2 size={13}/></button></div>
                    <details><summary>{tr('viewCandidate')}</summary><textarea aria-label={tr('candidateContent')} maxLength={20000} disabled={disabled} value={candidate.content} onChange={event => update(candidate.id, {content: event.target.value})}/></details>
                </article>)}
                </div>}
            </section>;
        })}</div>
        <div className="novel-synthesis-bar"><div><Check size={15}/><span>{t('novelStudio.selectedCandidates', {count: selectedCount})}</span></div><button className="modal-action-submit" disabled={disabled || !selectedCount} onClick={onSynthesize}><Sparkles size={15}/>{tr('synthesize')}</button></div>
        <div className="novel-settings-intro"><span className="novel-step">02</span><div><h2>{tr('finalSettings')}</h2><p>{tr('finalSettingsHelp')}</p></div></div>
        {children}
        {deleting && <ConfirmModal title={tr('deleteCandidate')} description={deleting.title} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('delete'), value: 'delete', variant: 'danger'}]} onClose={() => setDeleting(null)} onSelect={value => {if (value === 'delete') onChange(candidates.filter(candidate => candidate.id !== deleting.id)); setDeleting(null);}}/>}
    </div>;
}
