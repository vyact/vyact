import CandidateQuery from './CandidateQuery';
import {renderMarkdown} from '../../utils/markdownUtils';
import {useMemo, useState, type ReactNode} from 'react';
import {Check, Plus, Sparkles, Trash2, ChevronDown, Eye} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {SETTING_CATEGORIES, type SettingCandidate, type SettingCategory} from './storyStorage';

function CandidatePreview({candidate}: {candidate: SettingCandidate}) {
    const {t} = useTranslation('main');
    const [open, setOpen] = useState(false);
    const html = useMemo(() => open ? renderMarkdown(candidate.content) : '', [candidate.content, open]);
    return <details className="novel-candidate-preview" onToggle={event => setOpen(event.currentTarget.open)}>
        <summary>{t('novelStudio.candidateContent')}</summary>
        {open && <div className="novel-candidate-preview-content"><CandidateQuery candidate={candidate}/><div dangerouslySetInnerHTML={{__html: html}}/></div>}
    </details>;
}

interface SettingsPlannerProps {
    candidates: SettingCandidate[];
    disabled: boolean;
    onChange: (candidates: SettingCandidate[]) => void;
    onChoose: (category: SettingCategory) => void;
    onSynthesize: () => void;
    children: ReactNode;
    onView: (candidate: SettingCandidate) => void;
}

export default function SettingsPlanner({candidates, disabled, onChange, onChoose, onSynthesize, children, onView}: SettingsPlannerProps) {
    const {t} = useTranslation('main');
    const tr = (key: string) => t(`novelStudio.${key}`);
    const [expanded, setExpanded] = useState<Set<SettingCategory>>(() => new Set());
    const [deleting, setDeleting] = useState<SettingCandidate | null>(null);
    const update = (id: string, patch: Partial<SettingCandidate>) => onChange(candidates.map(candidate => candidate.id === id ? {...candidate, ...patch} : candidate));
    const selectedCount = candidates.filter(candidate => candidate.selected).length;
    return <div className="novel-settings-planner">

        <div className="novel-settings-intro"><span className="novel-step">01</span><div><h2>{tr('collectSettings')}</h2></div></div>
        <div className="novel-candidate-groups">{SETTING_CATEGORIES.map((category, index) => {
            const items = candidates.filter(candidate => candidate.category === category);
            const categorySelectedCount = items.filter(candidate => candidate.selected).length;
            return <section className="novel-candidate-group" key={category}>
                <header><button className="novel-group-toggle" onMouseDown={event => {if (event.detail > 1) event.preventDefault();}} aria-expanded={expanded.has(category)} onClick={() => setExpanded(previous => {const next = new Set(previous); if (next.has(category)) next.delete(category); else next.add(category); return next;})}>
                    <span className="novel-category-order">{String(index + 1).padStart(2, '0')}</span><span className="novel-group-label"><h3>{tr(category)}</h3><span>{tr(`${category}Hint`)}</span></span>{categorySelectedCount > 0 && <span className="novel-group-selection" aria-label={t('novelStudio.selectedCandidates', {count: categorySelectedCount})}><Check size={15} aria-hidden="true"/>{categorySelectedCount}</span>}<span className="novel-group-count">{items.length}</span><ChevronDown className={expanded.has(category) ? 'is-open' : ''} size={15}/></button><button className="titlebar-btn" disabled={disabled} aria-label={t('novelStudio.addCandidate', {category: tr(category)})} onClick={() => onChoose(category)}><Plus size={15}/></button></header>
                {expanded.has(category) && <div className="novel-group-candidates">
                {!items.length && <button className="novel-candidate-empty" disabled={disabled} onClick={() => onChoose(category)}><Plus size={15}/>{tr('candidateEmpty')}</button>}
                {items.map(candidate => <article className={`novel-candidate${candidate.selected ? ' is-selected' : ''}`} key={candidate.id}>
                    <div className="novel-candidate-title"><label className="novel-candidate-select"><input className="common-checkbox" type="checkbox" checked={candidate.selected} disabled={disabled} aria-label={t('novelStudio.selectCandidate', {title: candidate.title})} onChange={event => update(candidate.id, {selected: event.target.checked})}/><span>{candidate.title}</span></label><button className="titlebar-btn novel-candidate-open" disabled={disabled} aria-label={tr('viewShort')} data-tooltip-disabled="" onClick={() => onView(candidate)}><Eye size={15}/></button><button className="titlebar-btn novel-candidate-delete" disabled={disabled} aria-label={tr('delete')} onClick={() => setDeleting(candidate)}><Trash2 size={13}/></button></div>
                    <CandidatePreview candidate={candidate}/>
                </article>)}
                </div>}
            </section>;
        })}</div>

        {selectedCount > 0 && <div className="novel-synthesis-bar"><div className="novel-synthesis-selection"><div className="novel-synthesis-count"><Check size={15}/><span>{t('novelStudio.selectedCandidates', {count: selectedCount})}</span></div>{selectedCount > 0 && <ul className="novel-selected-candidates">{SETTING_CATEGORIES.flatMap(category => candidates.filter(candidate => candidate.category === category && candidate.selected).map(candidate => <li key={candidate.id}><input type="checkbox" className="common-checkbox novel-candidate-deselect" checked={candidate.selected} disabled={disabled} aria-label={t('novelStudio.deselectCandidate', {title: candidate.title || tr('candidateTitle')})} onChange={event => update(candidate.id, {selected: event.target.checked})}/><span className="novel-selected-category">{tr(category)}</span><span className="novel-selected-title">{candidate.title || tr('candidateTitle')}</span></li>))}</ul>}</div><button className="modal-action-submit" disabled={disabled || !selectedCount} onClick={onSynthesize}><Sparkles size={15}/>{tr('synthesize')}</button></div>}
        <div className="novel-settings-intro"><span className="novel-step">02</span><div><h2>{tr('finalSettings')}</h2></div></div>
        {children}
        {deleting && <ConfirmModal actionLayout="horizontal" title={tr('deleteCandidate')} description={deleting.title} options={[{label: tr('keep'), value: 'cancel'}, {label: tr('delete'), value: 'delete', variant: 'danger'}]} onClose={() => setDeleting(null)} onSelect={value => {if (value === 'delete') onChange(candidates.filter(candidate => candidate.id !== deleting.id)); setDeleting(null);}}/>}
    </div>;
}
