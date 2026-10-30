import type {WorkspaceEditSession} from './workspaceEditSession';
import {useEffect, useLayoutEffect, useMemo, useState, type ReactNode} from 'react';
import {FileText, LoaderCircle, Pencil, ArrowLeft} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {renderMarkdown} from '../../utils/markdownUtils';

export default function ProposalReader({text, action, busy, onChange, title, onReturn, context, maxLength, onTitleChange, onSessionChange, onSave}: {text: string; action: string; busy: boolean; onChange: (text: string) => void; title?: string; onReturn?: () => void; context?: ReactNode; maxLength?: number; onTitleChange?: (title: string) => void; onSessionChange?: (session: WorkspaceEditSession | null) => void; onSave?: (content: string, title: string) => void}) {
    const {t} = useTranslation('main');
    const [editing, setEditing] = useState(false);
    const [draft, setDraft] = useState(text);
    const [draftTitle, setDraftTitle] = useState(title ?? '');
    const [invalid, setInvalid] = useState(false);
    useEffect(() => {if (!editing) setDraft(text);}, [text, editing]);
    useEffect(() => {if (!editing) setDraftTitle(title ?? '');}, [title, editing]);
    const save = async () => {
        if (!draft.trim() || (maxLength && draft.length > maxLength)) {setInvalid(true); return false;}
        if (onSave) onSave(draft, draftTitle);
        else {onChange(draft); if (draftTitle !== (title ?? '')) onTitleChange?.(draftTitle);}
        setEditing(false); setInvalid(false); return true;
    };
    const discard = async () => {setDraft(text); setDraftTitle(title ?? ''); setEditing(false); setInvalid(false); return true;};
    useLayoutEffect(() => {
        if (onReturn) onSessionChange?.({dirty: editing && (draft !== text || draftTitle !== (title ?? '')), pending: busy, characterText: editing ? draft : text, validationError: !draft.trim() ? t('novelStudio.changes.emptySetting') : undefined, save, discard});
    });
    useLayoutEffect(() => () => onSessionChange?.(null), [onSessionChange]);
    const html = useMemo(() => renderMarkdown(text), [text]);
    return <section className="novel-response-reader" aria-label={t('novelStudio.proposal')}>
        <header><div className="novel-response-title"><span className="novel-response-eyebrow">{t(onReturn ? `novelStudio.${action}` : 'novelStudio.responseReview')}</span>{editing && (onTitleChange || onSave) ? <input className="novel-reader-title-editor" aria-label={t('novelStudio.candidateTitle')} maxLength={200} value={draftTitle} disabled={busy} onChange={event => setDraftTitle(event.target.value)}/> : <h2>{title || t(`novelStudio.${action}`)}</h2>}</div><div className="novel-response-tools"><button className={`novel-editor-action ${editing && onReturn ? 'modal-action-submit' : 'modal-action-cancel'}`} disabled={busy} aria-pressed={editing} onClick={() => {if (editing && onReturn) void save(); else setEditing(!editing);}}>{editing ? !onReturn && <FileText size={14}/> : <Pencil size={14}/>} {t(`novelStudio.${editing ? onReturn ? 'finishManuscriptEdit' : 'readResponse' : 'editResponse'}`)}</button>{editing && onReturn && <button className="modal-action-cancel novel-editor-action" onClick={() => void discard()}>{t('novelStudio.cancelEdit')}</button>}{onReturn && <button className="modal-action-cancel novel-editor-action novel-editor-back" onClick={onReturn}><ArrowLeft size={15}/>{t('novelStudio.backToList')}</button>}</div></header>
        {busy ? <div className="novel-response-loading" role="status"><LoaderCircle className="novel-spinner" size={24}/><h3>{t('novelStudio.generatingResponse')}</h3><p>{t('novelStudio.responseHelp')}</p></div>
            : editing ? <><textarea className="novel-response-editor" aria-label={t('novelStudio.proposal')} value={onReturn ? draft : text} maxLength={maxLength} onChange={event => {setInvalid(false); if (onReturn) setDraft(event.target.value); else onChange(event.target.value);}}/>{invalid && <p role="alert" className="novel-error">{t('novelStudio.changes.emptySetting')}</p>}</>
                : <article className="novel-response-content">{context}<div dangerouslySetInnerHTML={{__html: html}}/></article>}
    </section>;
}
