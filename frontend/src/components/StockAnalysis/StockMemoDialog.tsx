import {useState} from 'react';
import {useTranslation} from 'react-i18next';
import type {StockMemo, StockMemoDraft} from '../../services/stockAnalysis';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';

export default function StockMemoDialog({day, name, memo, editing, onEdit, onClose, onSave}: {
    day: string;
    name: string;
    memo?: StockMemo;
    editing: boolean;
    onEdit: () => void;
    onClose: () => void;
    onSave: (draft: StockMemoDraft) => Promise<void>;
}) {
    const {t, i18n} = useTranslation(['main', 'common']);
    const [title, setTitle] = useState(memo?.title ?? '');
    const [content, setContent] = useState(memo?.content ?? '');
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState(false);
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
    return <ModalOverlay onClose={saving ? undefined : onClose} closeOnBackdrop captureEscape aria-labelledby="stock-memo-heading">
        <form
              className="stock-chart-settings stock-memo-dialog" onSubmit={event => {event.preventDefault(); void save();}}>
            <header className="stock-memo-heading">
                <h2 id="stock-memo-heading">{editing ? name : memo?.title}</h2>
                <time dateTime={day}>{date}</time>
            </header>
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
                <footer>
                    <button type="button" className="modal-action-cancel" onClick={onClose}>{t('common:close')}</button>
                    <button type="button" className="modal-action-submit" onClick={onEdit}>{t('common:edit')}</button>
                </footer>
            </>}
        </form>
    </ModalOverlay>;
}
