import useGenerationExitConfirmation from './useGenerationExitConfirmation';
import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {LoaderCircle, Sparkles, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {getTitleSources, selectTitleSources} from './titleSuggestions';
import type {Story} from './storyStorage';
import './TitleSuggestionModal.css';

interface Suggestion {title: string; reason: string}
export default function TitleSuggestionModal({story, onClose, onApply, onGenerationChange}: {story: Story; onClose: () => void; onApply: (title: string) => void; onGenerationChange?: (activity: {abort: () => void} | null) => void}) {
    const {t, i18n} = useTranslation('main');
    const tr = (key: string) => t(`novelStudio.titleSuggestions.${key}`);
    const groups = getTitleSources(story);
    const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
    const [instruction, setInstruction] = useState('');
    const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
    const [selectedTitle, setSelectedTitle] = useState('');
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState('');
    const controller = useRef<AbortController | null>(null);
    useEffect(() => () => controller.current?.abort(), []);
    const {requestExit, confirmation: exitConfirmation} = useGenerationExitConfirmation(busy, () => {controller.current?.abort(); onClose();});
    useLayoutEffect(() => {
        onGenerationChange?.(busy ? {abort: () => controller.current?.abort()} : null);
        return () => onGenerationChange?.(null);
    }, [busy, onGenerationChange]);
    const selected = selectTitleSources([...groups.chapters, ...groups.settings], excluded);
    const recommend = async () => {
        if (busy || !selected.length) return;
        setBusy(true); setError(''); controller.current = new AbortController();
        try {
            const response = await fetch('/api/novel-studio/title-suggestions', {method: 'POST', headers: {'Content-Type': 'application/json'}, signal: controller.current.signal, body: JSON.stringify({current_title: story.title, sources: selected.map(({title, content}) => ({title, content})), instruction: instruction.trim(), language: i18n.resolvedLanguage || i18n.language})});
            if (!response.ok) throw new Error('Title recommendation failed');
            const result = await response.json();
            if (!Array.isArray(result.suggestions) || !result.suggestions.length || result.suggestions.some((item: Suggestion) => typeof item.title !== 'string' || !item.title.trim() || typeof item.reason !== 'string')) throw new Error('Invalid title recommendations');
            setSuggestions(result.suggestions); setSelectedTitle('');
        } catch (failure) {if (!(failure instanceof DOMException && failure.name === 'AbortError')) setError(tr('error'));}
        finally {setBusy(false); controller.current = null;}
    };
    return <ModalOverlay onClose={requestExit} closeOnBackdrop className="novel-title-overlay" aria-labelledby="novel-title-modal-heading">
        <section className="novel-title-modal"><header><h2 id="novel-title-modal-heading"><Sparkles size={18}/>{tr('title')}</h2><button type="button" className="titlebar-btn" aria-label={tr('close')} onClick={requestExit}><X size={18}/></button></header>
            <div className="novel-title-modal-body"><p className="novel-title-help">{tr('help')}</p><div className="novel-title-sources">{(['chapters', 'settings'] as const).map(group => <section key={group}><h3>{tr(group)}</h3><div className="novel-title-source-list">{!groups[group].length && <p className="novel-title-empty">{tr('empty')}</p>}{groups[group].map(source => <div className="novel-title-source" key={source.id}><span>{source.title}</span><ToggleSwitch checked={!excluded.has(source.id)} disabled={busy} label={t('novelStudio.titleSuggestions.includeSource', {title: source.title})} onChange={included => {setExcluded(previous => {const next = new Set(previous); if (included) next.delete(source.id); else next.add(source.id); return next;}); setSuggestions([]); setSelectedTitle('');}}/></div>)}</div></section>)}</div>
                <label className="novel-title-instruction">{tr('direction')}<textarea value={instruction} maxLength={1000} disabled={busy} placeholder={tr('placeholder')} onChange={event => setInstruction(event.target.value)}/></label>
                {error && <p role="alert" className="novel-error">{error}</p>}
                {suggestions.length > 0 && <fieldset className="novel-title-results"><legend>{tr('results')}</legend><div className="novel-title-result-list">{suggestions.map(item => <label className={selectedTitle === item.title ? 'is-selected' : ''} key={item.title}><input type="radio" name="novel-suggested-title" checked={selectedTitle === item.title} onChange={() => setSelectedTitle(item.title)}/><span><strong>{item.title}</strong><small>{item.reason}</small></span></label>)}</div></fieldset>}
            </div><footer><button className="modal-action-cancel" onClick={requestExit}>{tr('close')}</button>{busy ? <button className="modal-action-cancel" onClick={() => controller.current?.abort()}><LoaderCircle className="novel-spinner" size={15}/>{tr('cancel')}</button> : <button className="modal-action-cancel" disabled={!selected.length} onClick={() => void recommend()}><Sparkles size={15}/>{tr('generate')}</button>}<button className="modal-action-submit" disabled={busy || !selectedTitle} onClick={() => {onApply(selectedTitle); onClose();}}>{tr('apply')}</button></footer>
        </section>
        {exitConfirmation}
    </ModalOverlay>;
}
