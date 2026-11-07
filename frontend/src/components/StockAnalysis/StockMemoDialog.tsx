import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import {CalendarDays, Pencil, Trash2} from 'lucide-react';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import type {StockMemo, StockMemoDraft} from '../../services/stockAnalysis';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import './StockMemoDialog.css';

export default function StockMemoDialog({day, name, memo, editing, onEdit, onClose, onSave, onDelete}: {
    day: string;
    name: string;
    memo?: StockMemo;
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    onSave: (draft: StockMemoDraft) => Promise<void>;
    onDelete: () => Promise<void>;
}) {
    const {t, i18n} = useTranslation(['main', 'common']);
    const [title, setTitle] = useState(memo?.title ?? '');
    const [content, setContent] = useState(memo?.content ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState(false);
    const [deleting, setDeleting] = useState(false);
    const [deleteError, setDeleteError] = useState(false);
    const remove = async () => {
        if (deleting) return;
        setDeleting(true);
        setDeleteError(false);
        try {
            await onDelete();
        } catch {
            setDeleteError(true);
            setConfirmDelete(false);
            setDeleting(false);
        }
    };
    const date = new Intl.DateTimeFormat(i18n.resolvedLanguage, {dateStyle: 'medium', timeZone: 'UTC'}).format(new Date(day));
    const save = async () => {
        if (saving || !title.trim()) return;
        setSaving(true);
        setError(false);
        try {
            await onSave({title: title.trim(), content: content.trim()});
        } catch {
            setError(true);
            setSaving(false);
        }
    };
    return <ModalOverlay onClose={saving || deleting ? undefined : onClose} closeOnBackdrop captureEscape aria-labelledby="stock-memo-heading">
        <form
              className="stock-memo-dialog" onSubmit={event => {event.preventDefault(); void save();}}>
            <header className="stock-memo-heading">
                <div className="stock-memo-context">
                    <span id={editing ? 'stock-memo-heading' : undefined}>{name}</span>
                    <time dateTime={day}><CalendarDays size={13} aria-hidden="true"/>{date}</time>
                </div>
                <ModalCloseButton disabled={saving || deleting} onClick={onClose}/>
            </header>
            {!editing && <h2 id="stock-memo-heading">{memo?.title}</h2>}
            {editing ? <>
                <input aria-label={t('stockAnalysis.memoTitle')} placeholder={t('stockAnalysis.memoTitle')}
                       value={title} maxLength={120} required disabled={saving} onChange={event => setTitle(event.target.value)}/>
                <textarea aria-label={t('stockAnalysis.memoContent')} placeholder={t('stockAnalysis.memoContent')}
                          value={content} maxLength={10000} disabled={saving} onChange={event => setContent(event.target.value)}/>
                {error && <p role="alert">{t('stockAnalysis.memoSaveError')}</p>}
                <footer>
                    <button type="button" className="modal-action-cancel" disabled={saving} onClick={onClose}>{t('common:cancel')}</button>
                    <button type="submit" className="modal-action-submit" disabled={saving || !title.trim()}>{t('common:save')}</button>
                </footer>
            </> : <>
                <p className="stock-memo-content">{memo?.content}</p>
                {deleteError && <p role="alert">{t('stockAnalysis.memoDeleteError')}</p>}
                <footer>
                    <button type="button" className="modal-action-cancel stock-memo-delete" disabled={deleting} onClick={() => setConfirmDelete(true)}><Trash2 size={14} aria-hidden="true"/>{t('common:delete')}</button>
                    <button type="button" className="modal-action-submit" disabled={deleting} onClick={onEdit}><Pencil size={14} aria-hidden="true"/>{t('common:edit')}</button>
                </footer>
            </>}
        </form>
        {confirmDelete && <ConfirmModal className="stock-memo-delete-confirm" title={t('stockAnalysis.memoDeleteConfirm')} description={memo?.title}
            actionLayout="horizontal" loading={deleting} loadingValue="delete"
            options={[{value: 'cancel', label: t('common:cancel')}, {value: 'delete', label: t('common:delete'), variant: 'danger'}]}
            onClose={() => setConfirmDelete(false)} onSelect={value => {if (value === 'delete') void remove(); else setConfirmDelete(false);}}/>}
    </ModalOverlay>;
}
