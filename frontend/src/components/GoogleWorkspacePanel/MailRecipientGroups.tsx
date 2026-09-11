import '../common/ModalOverlay/ModalActions.css';
import {useImperativeHandle, useRef, useState, type Ref} from 'react';
import {useTranslation} from 'react-i18next';
import {Check, Mail, Pencil, Plus, Trash2, Users, X} from 'lucide-react';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';

import {hasRecipientGroupChanges, type MailRecipientGroup} from './mailRecipientGroupUtils';

export type RecipientGroupEditorHandle = {isDirty: () => boolean; save: () => Promise<boolean>};

export default function MailRecipientGroups({groups, onSave, loading, editorRef}: {
    editorRef?: Ref<RecipientGroupEditorHandle>;
    groups: MailRecipientGroup[];
    onSave: (groups: MailRecipientGroup[]) => Promise<void>;
    loading: boolean;
}) {
    const {t} = useTranslation('main');
    const [draft, setDraft] = useState<MailRecipientGroup | null>(null);
    const [address, setAddress] = useState('');
    const [editingEmail, setEditingEmail] = useState<number | null>(null);
    const addressInput = useRef<HTMLInputElement>(null);
    const [busy, setBusy] = useState(false);
    const [deleting, setDeleting] = useState<MailRecipientGroup | null>(null);
    const [error, setError] = useState('');
    const resetAddress = () => { setAddress(''); setEditingEmail(null); setError(''); };
    const edit = (group: MailRecipientGroup) => { setDraft({...group, emails: [...group.emails]}); resetAddress(); };
    const normalizedAddress = address.trim().toLowerCase();
    const addressError = !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(normalizedAddress)
        ? 'googleWorkspace.invalidEmail'
        : draft?.emails.some((item, index) => index !== editingEmail && item.toLowerCase() === normalizedAddress)
            ? 'googleWorkspace.recipientGroupDuplicate'
            : editingEmail === null && (draft?.emails.length || 0) >= 500
                ? 'googleWorkspace.recipientGroupLimit'
                : '';
    const commitAddress = (): MailRecipientGroup | null => {
        if (!draft || busy) return null;
        if (addressError) { setError(t(addressError)); return null; }
        const email = normalizedAddress;
        const next = {...draft, emails: editingEmail === null ? [...draft.emails, email] : draft.emails.map((item, index) => index === editingEmail ? email : item)};
        setDraft(next);
        resetAddress();
        addressInput.current?.focus();
        return next;
    };
    const persist = async (next: MailRecipientGroup[]) => {
        setBusy(true);
        try { await onSave(next); setDraft(null); setDeleting(null); return true; } catch { return false; }
        finally { setBusy(false); }
    };
    const saveDraft = async () => {
        if (!draft || busy || !draft.name.trim()) return false;
        const pending = address.trim() || editingEmail !== null ? commitAddress() : draft;
        if (!pending || !pending.emails.length) return false;
        const group = {...pending, name: pending.name.trim()};
        return persist(groups.some(item => item.id === group.id) ? groups.map(item => item.id === group.id ? group : item) : [...groups, group]);
    };
    useImperativeHandle(editorRef, () => ({
        isDirty: () => hasRecipientGroupChanges(draft, groups.find(item => item.id === draft?.id), address, editingEmail),
        save: saveDraft,
    }));
    return <div className="gwp-recipient-groups">
        <div className="gwp-signature-preview-heading"><h4>{t('googleWorkspace.recipientGroups')}</h4>{!draft && <button type="button" className="gwp-signature-edit-button" disabled={loading || busy} onClick={() => edit({id: crypto.randomUUID(), name: '', emails: []})}>{t('googleWorkspace.addRecipientGroup')}</button>}</div>
        {draft ? <form className="gwp-recipient-group-form" onSubmit={event => {
            event.preventDefault();
            void saveDraft();
        }}>
            <label>{t('googleWorkspace.recipientGroupName')}<input autoFocus value={draft.name} maxLength={100} disabled={busy} onChange={event => setDraft({...draft, name: event.target.value})}/></label>
            <div className="gwp-group-address-entry">
                <label htmlFor="recipient-group-address">{t('googleWorkspace.recipientGroupEmails')}</label>
                <div className="gwp-group-address-input">
                    <input id="recipient-group-address" ref={addressInput} value={address} disabled={busy} autoComplete="off" inputMode="email" aria-invalid={Boolean(error)} aria-describedby={error ? 'recipient-group-address-error' : undefined} onChange={event => { setAddress(event.target.value); setError(''); }} onKeyDown={event => {
                        if (event.key === 'Enter' && !event.nativeEvent.isComposing) { event.preventDefault(); commitAddress(); }
                        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); resetAddress(); }
                    }} placeholder={t('googleWorkspace.recipientGroupEmailsHint')}/>
                    <button type="button" className="gwp-primary" disabled={busy || Boolean(addressError)} aria-label={t(editingEmail === null ? 'googleWorkspace.addRecipientAddress' : 'googleWorkspace.edit')} onClick={commitAddress}>{editingEmail === null ? <Plus size={18}/> : <Check size={18}/>}</button>
                    {editingEmail !== null && <button type="button" className="gwp-group-secondary" disabled={busy} aria-label={t('googleWorkspace.cancel')} onClick={resetAddress}><X size={18}/></button>}
                </div>
                {error && <p id="recipient-group-address-error" className="gwp-group-address-error" role="alert">{error}</p>}
            </div>
            {draft.emails.length > 0 && <ul className="gwp-group-address-list">{draft.emails.map((email, index) => <li key={email} className={editingEmail === index ? 'editing' : ''}>
                <Mail size={17} aria-hidden="true"/><span>{email}</span>
                <div className="gwp-mail-macro-actions">
                    <button type="button" className="edit" aria-label={`${t('googleWorkspace.edit')}: ${email}`} disabled={busy} onClick={() => { setEditingEmail(index); setAddress(email); setError(''); addressInput.current?.focus(); }}><Pencil size={16}/></button>
                    <button type="button" className="delete" aria-label={`${t('googleWorkspace.delete')}: ${email}`} disabled={busy} onClick={() => {
                        setDraft({...draft, emails: draft.emails.filter((_, position) => position !== index)});
                        if (editingEmail === index) resetAddress();
                        else if (editingEmail !== null && editingEmail > index) setEditingEmail(editingEmail - 1);
                    }}><Trash2 size={16}/></button>
                </div>
            </li>)}</ul>}
            <footer className="modal-action-footer"><button type="button" className="gwp-signature-cancel" disabled={busy} onClick={() => setDraft(null)}>{t('googleWorkspace.cancel')}</button><button type="submit" className="gwp-primary gwp-signature-save" disabled={busy || !draft.name.trim() || (!draft.emails.length && !address.trim())}>{t('googleWorkspace.saveLabel')}</button></footer>
        </form> : <div className="gwp-recipient-group-list">{groups.length ? groups.map(group => <article className="gwp-recipient-group-card" key={group.id}>
            <div className="gwp-recipient-group-heading">
                <span className="gwp-recipient-group-icon"><Users size={19} aria-hidden="true"/></span>
                <strong>{group.name}</strong>
                <span className="gwp-recipient-group-count" aria-label={t('googleWorkspace.recipientGroupCount', {count: group.emails.length})}>{group.emails.length}</span>
                <span className="gwp-recipient-group-actions">
                    <button type="button" disabled={busy || loading} aria-label={`${t('googleWorkspace.edit')}: ${group.name}`} onClick={() => edit(group)}><Pencil size={16}/></button>
                    <button type="button" className="delete" disabled={busy || loading} aria-label={`${t('googleWorkspace.delete')}: ${group.name}`} onClick={() => setDeleting(group)}><Trash2 size={16}/></button>
                </span>
            </div>
            <div className="gwp-recipient-group-chips">{group.emails.map(email => <span key={email}>{email}</span>)}</div>
        </article>) : <p>{t(loading ? 'googleWorkspace.loading' : 'googleWorkspace.noRecipientGroups')}</p>}</div>}
        {deleting && <ConfirmModal title={t('googleWorkspace.deleteRecipientGroup', {name: deleting.name})} options={[{label: t('googleWorkspace.cancel'), value: 'cancel'}, {label: t('googleWorkspace.delete'), value: 'delete', variant: 'danger'}]} onSelect={value => { if (busy) return; if (value === 'delete') void persist(groups.filter(group => group.id !== deleting.id)); else setDeleting(null); }} onClose={() => { if (!busy) setDeleting(null); }} actionLayout="horizontal"/>}
    </div>;
}
