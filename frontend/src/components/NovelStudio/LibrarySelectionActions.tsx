import {Plus, Trash2, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';

interface Props {
    selecting: boolean;
    count: number;
    disabled: boolean;
    selectLabel: string;
    createLabel: string;
    onStart: () => void;
    onCancel: () => void;
    onDone: () => void;
    onCreate: () => void;
}

export default function LibrarySelectionActions({selecting, count, disabled, selectLabel, createLabel, onStart, onCancel, onDone, onCreate}: Props) {
    const {t} = useTranslation('main');
    return <div className="novel-library-actions">{selecting ? <>
        <button type="button" className="titlebar-btn" disabled={disabled} aria-label={t('novelStudio.cancelEdit')} onClick={onCancel}><X size={16}/></button>
        <button type="button" className="novel-bulk-delete" disabled={disabled || !count} onClick={onDone}><Trash2 size={14} aria-hidden="true"/><span>{t('novelStudio.delete')}</span><span className="novel-bulk-delete-count">{new Intl.NumberFormat().format(count)}</span></button>
    </> : <>
        <button type="button" className="novel-library-delete" disabled={disabled} aria-label={selectLabel} onClick={onStart}><Trash2 size={16}/></button>
        <button type="button" className="titlebar-btn" disabled={disabled} aria-label={createLabel} onClick={onCreate}><Plus size={16}/></button>
    </>}</div>;
}
