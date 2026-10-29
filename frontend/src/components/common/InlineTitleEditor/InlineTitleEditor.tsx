import {useRef, useState} from 'react';
import {Check, Pencil, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './InlineTitleEditor.css';

export default function InlineTitleEditor({title, disabled = false, onChange, inputLabel, editLabel}: {title: string; disabled?: boolean; inputLabel?: string; editLabel?: string; onChange: (title: string) => void}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(title);
    const cancelled = useRef(false);
    const commit = () => {
        if (!cancelled.current && draft.trim() && draft.trim() !== title) onChange(draft.trim());
        setEditing(false);
    };
    return <div className="inline-title-editor">{editing ? <>
        <input autoFocus aria-label={inputLabel ?? t('novelStudio.candidateTitle')} maxLength={200} value={draft} disabled={disabled} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {if (event.key === 'Enter' && !event.nativeEvent.isComposing) {event.preventDefault(); commit();} else if (event.key === 'Escape') {event.preventDefault(); event.stopPropagation(); cancelled.current = true; setEditing(false);}}}/>
        <button type="button" disabled={disabled} aria-label={t('novelStudio.saveShort')} onMouseDown={event => event.preventDefault()} onClick={commit}><Check size={14}/></button>
        <button type="button" disabled={disabled} aria-label={t('novelStudio.cancel')} onMouseDown={event => event.preventDefault()} onClick={() => {cancelled.current = true; setEditing(false);}}><X size={14}/></button>
    </> : <><span>{title}</span><button type="button" disabled={disabled} aria-label={editLabel ?? t('novelStudio.editCandidateTitle')} data-tooltip-disabled="" onClick={() => {cancelled.current = false; setDraft(title); setEditing(true);}}><Pencil size={14}/></button></>}</div>;
}
