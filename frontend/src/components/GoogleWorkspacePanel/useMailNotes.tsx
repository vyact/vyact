import {useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {LoaderCircle, Pencil, Save, NotebookPen} from 'lucide-react';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import '../common/ModalOverlay/ModalActions.css';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {useWorkspace} from './WorkspaceContext';
import {notifyWorkspaceError} from '../../utils/workspaceError';
import './mailNotes.css';

type Note = {content: string; updated_at: string};
type Target = {id: string; subject: string};
const MAX_NOTE_LENGTH = 20_000;
const LOOKUP_BATCH_SIZE = 200;

function NoteContent({content}: {content: string}) {
    return <div className="gwp-note-content">{content.split(/(https?:\/\/[^\s<>]+)/g).map((part, index) => {
        if (!/^https?:\/\//i.test(part)) return part;
        const url = part.replace(/[.,;!?)\]}]+$/, '');
        return <span key={index}><a href={url} target="_blank" rel="noopener noreferrer" onClick={event => {
            if (window.ragAPI?.openExternal) {
                event.preventDefault();
                void window.ragAPI.openExternal(url).catch(notifyWorkspaceError);
            }
        }}>{url}</a>{part.slice(url.length)}</span>;
    })}</div>;
}

export function useMailNotes(ids: string[]) {
    const {api, accountId, provider} = useWorkspace();
    const {t, i18n} = useTranslation('main');
    const [notes, setNotes] = useState<Record<string, Note>>({});
    const [loading, setLoading] = useState(true);
    const [failed, setFailed] = useState(false);
    const [reload, setReload] = useState(0);
    const [target, setTarget] = useState<Target | null>(null);
    const [draft, setDraft] = useState('');
    const [editing, setEditing] = useState(false);
    const [saving, setSaving] = useState(false);
    const [discardOpen, setDiscardOpen] = useState(false);
    const scope = `${provider}:${accountId}`;
    const saveRevisionRef = useRef(0);
    const scopeRef = useRef(scope);
    scopeRef.current = scope;
    const lookupKey = JSON.stringify([...new Set(ids)].sort());
    useEffect(() => {
        setTarget(null); setNotes({}); setDiscardOpen(false); setSaving(false);
    }, [scope]);
    useEffect(() => {
        let cancelled = false;
        const revision = saveRevisionRef.current;
        setLoading(true); setFailed(false);
        const lookupIds: string[] = JSON.parse(lookupKey);
        void (async () => {
            const result: Record<string, Note> = {};
            for (let offset = 0; offset < lookupIds.length; offset += LOOKUP_BATCH_SIZE) {
                Object.assign(result, (await api.getMailNotes(accountId, lookupIds.slice(offset, offset + LOOKUP_BATCH_SIZE))).notes);
            }
            if (!cancelled && revision === saveRevisionRef.current) setNotes(result);
        })().catch(error => { if (!cancelled) { setFailed(true); notifyWorkspaceError(error); } })
            .finally(() => { if (!cancelled) setLoading(false); });
        return () => { cancelled = true; };
    }, [api, accountId, scope, lookupKey, reload]);
    const stored = target ? notes[target.id] : undefined;
    const close = () => {
        if (saving) return;
        if (draft !== (stored?.content || '')) setDiscardOpen(true);
        else setTarget(null);
    };
    const save = async () => {
        if (!target || saving) return;
        setSaving(true);
        try {
            const note = await api.saveMailNote(accountId, target.id, draft);
            if (scopeRef.current !== scope) return;
            saveRevisionRef.current += 1;
            setNotes(current => ({...current, [target.id]: note}));
            setDraft(note.content); setEditing(false);
            if (!note.content) setTarget(null);
        } catch (error) { if (scopeRef.current === scope) notifyWorkspaceError(error); }
        finally { if (scopeRef.current === scope) setSaving(false); }
    };
    const button = (item: Target) => <button type="button" className={`gwp-note-trigger${notes[item.id]?.content ? ' has-note' : ''}`} disabled={loading} aria-label={t(notes[item.id]?.content ? 'googleWorkspace.mailNote.view' : 'googleWorkspace.mailNote.add')} onClick={() => {
        if (failed) { setReload(value => value + 1); return; }
        setTarget(item); setDraft(notes[item.id]?.content || ''); setEditing(!notes[item.id]?.content);
    }}><NotebookPen size={18} strokeWidth={1.8} aria-hidden="true"/></button>;
    const modal = target && <ModalOverlay className="gwp-note-overlay" captureEscape onClose={close} closeOnBackdrop={!saving} aria-label={t('googleWorkspace.mailNote.title')}>
        <section className="gwp-note-modal">
            <header><div className="gwp-note-heading"><NotebookPen size={21} aria-hidden="true"/><div><h3>{t('googleWorkspace.mailNote.title')}</h3><p>{target.subject || t('googleWorkspace.noSubject')}</p></div></div><ModalCloseButton onClick={close} disabled={saving}/></header>
            <div className="gwp-note-body">{editing ? <><label htmlFor="mail-note-content">{t('googleWorkspace.mailNote.label')}</label><textarea id="mail-note-content" autoFocus value={draft} maxLength={MAX_NOTE_LENGTH} disabled={saving} onChange={event => setDraft(event.target.value)} placeholder={t('googleWorkspace.mailNote.placeholder')}/></> : <NoteContent content={stored?.content || ''}/>}</div>
            <footer className="modal-action-footer"><small>{stored?.updated_at ? t('googleWorkspace.mailNote.updated', {date: new Date(stored.updated_at).toLocaleString(i18n.resolvedLanguage || i18n.language)}) : null}</small><div className="gwp-note-actions"><button type="button" className="modal-action-cancel" onClick={close} disabled={saving}>{t(editing ? 'common:cancel' : 'common:close')}</button>{editing ? <button type="button" className="modal-action-submit" disabled={saving || draft === (stored?.content || '')} onClick={() => void save()}>{saving ? <LoaderCircle className="gwp-spin" size={16}/> : <Save size={16}/>} {t('googleWorkspace.mailNote.save')}</button> : <button type="button" className="modal-action-submit" onClick={() => setEditing(true)}><Pencil size={16}/>{t('googleWorkspace.mailNote.edit')}</button>}</div></footer>
        </section>
        {discardOpen && <ConfirmModal title={t('googleWorkspace.mailNote.discard')} options={[{label: t('googleWorkspace.mailNote.keep'), value: 'keep'}, {label: t('googleWorkspace.mailNote.discardAction'), value: 'discard', variant: 'danger'}]} onClose={() => setDiscardOpen(false)} onSelect={value => { setDiscardOpen(false); if (value === 'discard') setTarget(null); }}/>}
    </ModalOverlay>;
    return {button, modal};
}
