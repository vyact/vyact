import {useEffect, useId, useRef, useState} from 'react';
import {Bookmark, Pencil, Plus, Trash2, GripVertical} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';
import ModalCloseButton from '../common/ModalOverlay/ModalCloseButton';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {loadSavedQuestions, readSavedQuestionCache, saveQuestions, SAVED_QUESTION_LIMIT, SAVED_QUESTION_TEXT_LIMIT, SAVED_QUESTION_TITLE_LIMIT, type QuestionScope, type SavedStockQuestion} from './savedStockQuestions';
import './StockSavedQuestionsDialog.css';
import StockSavedQuestionPreview from './StockSavedQuestionPreview';
import {reorderItems} from './groupOrdering';

export default function StockSavedQuestionsDialog({scope, draft, onSelect, onClose, createOnOpen = false}: {
    scope: QuestionScope; draft: string; createOnOpen?: boolean; onSelect: (question: string) => void; onClose: () => void;
}) {
    const {t} = useTranslation(['main', 'common']);
    const tr = (key: string) => t(`stockAnalysis.savedQuestions.${key}`);
    const id = useId();
    const [items, setItems] = useState(() => readSavedQuestionCache(scope));
    const [loaded, setLoaded] = useState(false);
    const [error, setError] = useState(false);
    const [saving, setSaving] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const [editing, setEditing] = useState<SavedStockQuestion | null>(() => createOnOpen ? {id: crypto.randomUUID(), title: '', question: draft} : null);
    const dragging = useRef<string | null>(null);
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dropTarget, setDropTarget] = useState<{id: string; after: boolean} | null>(null);
    const [deleting, setDeleting] = useState<SavedStockQuestion | null>(null);
    useEffect(() => {
        const controller = new AbortController();
        setError(false); setLoaded(false);
        loadSavedQuestions(scope, controller.signal).then(rows => {
            if (!controller.signal.aborted) {setItems(rows); setLoaded(true);}
        }).catch(() => {if (!controller.signal.aborted) setError(true);});
        return () => controller.abort();
    }, [scope, attempt]);
    const resetDrag = () => {
        dragging.current = null; setDraggingId(null); setDropTarget(null);
        if (document.activeElement instanceof HTMLElement && document.activeElement.closest('.stock-saved-questions li')) {
            document.activeElement.blur();
        }
    };
    useEffect(() => {
        const finish = () => {if (dragging.current) resetDrag();};
        window.addEventListener('dragend', finish);
        window.addEventListener('drop', finish);
        window.addEventListener('blur', finish);
        return () => {
            window.removeEventListener('dragend', finish);
            window.removeEventListener('drop', finish);
            window.removeEventListener('blur', finish);
        };
    }, []);
    const persist = async (next: SavedStockQuestion[], optimistic = false) => {
        if (!loaded || saving) return;
        const previous = items;
        if (optimistic) setItems(next);
        setSaving(true); setError(false);
        try {await saveQuestions(scope, next); setItems(next); setEditing(null); setDeleting(null);}
        catch {if (optimistic) setItems(previous); setError(true); setDeleting(null);} finally {setSaving(false);}
    };
    return <ModalOverlay onClose={saving ? undefined : onClose} closeOnBackdrop captureEscape aria-labelledby={`${id}-heading`}>
        <section className="stock-saved-questions">
            <header><div className="stock-saved-questions-heading"><h2 id={`${id}-heading`}>{tr('title')}</h2><span>{tr(scope === 'stock' ? 'stockScope' : 'groupScope')}</span></div>
                <ModalCloseButton onClick={onClose} disabled={saving}/></header>
            {error && <div className="stock-saved-questions-error" role="alert">{tr('error')}
                {!loaded && <button type="button" className="modal-action-cancel" onClick={() => setAttempt(value => value + 1)}>{t('common:retry')}</button>}</div>}
            {!loaded && !error && <p role="status">{t('common:loading')}</p>}
            {editing ? <form onSubmit={event => {
                event.preventDefault();
                const entry = {...editing, title: editing.title.trim(), question: editing.question.trim()};
                if (!entry.title || !entry.question) return;
                void persist(items.some(item => item.id === entry.id) ? items.map(item => item.id === entry.id ? entry : item) : [...items, entry]);
            }}>
                <label htmlFor={`${id}-title`}>{tr('name')}</label>
                <input id={`${id}-title`} autoFocus required maxLength={SAVED_QUESTION_TITLE_LIMIT} value={editing.title} disabled={saving}
                    onChange={event => setEditing({...editing, title: event.target.value})}/>
                <label htmlFor={`${id}-question`}>{tr('question')}</label>
                <textarea id={`${id}-question`} required maxLength={SAVED_QUESTION_TEXT_LIMIT} rows={6} value={editing.question} disabled={saving}
                    onChange={event => setEditing({...editing, question: event.target.value})}/>
                <footer><button type="button" className="modal-action-cancel" disabled={saving} onClick={() => setEditing(null)}>{t('common:cancel')}</button>
                    <button className="modal-action-submit" disabled={!loaded || saving || !editing.title.trim() || !editing.question.trim()}>{t(saving ? 'common:saving' : 'common:save')}</button></footer>
            </form> : <>
                <div className="stock-saved-questions-toolbar"><button type="button" className="modal-action-cancel" disabled={!loaded || saving || items.length >= SAVED_QUESTION_LIMIT}
                    onClick={() => setEditing({id: crypto.randomUUID(), title: '', question: ''})}><Plus size={14} aria-hidden="true"/>{tr('add')}</button></div>
                {!items.length && loaded && <div className="stock-saved-questions-empty"><Bookmark size={24} aria-hidden="true"/><p>{tr('empty')}</p></div>}
                <ul>{items.map(item => <li key={item.id} className={`${draggingId === item.id ? 'is-dragging' : ''}${dropTarget?.id === item.id ? ' is-drop-target' : ''}`}
                    draggable={loaded && !saving} onDragStart={event => {
                        if ((event.target as HTMLElement).closest('.stock-saved-question-actions')) {event.preventDefault(); return;}
                        dragging.current = item.id; setDraggingId(item.id);
                        event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', item.id);
                    }} onDragEnd={resetDrag}
                    onDragLeave={event => {
                        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDropTarget(previous => previous?.id === item.id ? null : previous);
                    }}
                    onDragOver={event => {
                        if (!dragging.current || dragging.current === item.id || saving) return;
                        event.preventDefault(); event.dataTransfer.dropEffect = 'move';
                        const after = items.findIndex(entry => entry.id === dragging.current) < items.indexOf(item);
                        setDropTarget(previous => previous?.id === item.id && previous.after === after ? previous : {id: item.id, after});
                    }} onDrop={event => {
                        event.preventDefault();
                        const source = items.find(entry => entry.id === dragging.current);
                        resetDrag();
                        if (source && source !== item && !saving) void persist(reorderItems(items, source, item, items.indexOf(source) < items.indexOf(item)), true);
                    }}>
                    <button type="button" className="stock-saved-question-drag" disabled={!loaded || saving}
                        aria-label={tr('reorder')}
                        onKeyDown={event => {
                            if (!event.altKey || !['ArrowUp', 'ArrowDown'].includes(event.key) || saving) return;
                            event.preventDefault();
                            const index = items.indexOf(item); const after = event.key === 'ArrowDown';
                            const target = items[index + (after ? 1 : -1)];
                            if (target) void persist(reorderItems(items, item, target, after), true);
                        }}><GripVertical size={14} aria-hidden="true"/></button>
                    <button type="button" className="stock-saved-question-select" disabled={saving} onClick={() => onSelect(item.question)}><strong>{item.title}</strong><StockSavedQuestionPreview text={item.question}/></button>
                    <div className="stock-saved-question-actions"><button type="button" disabled={!loaded || saving} aria-label={t('common:edit')} onClick={() => setEditing({...item})}><Pencil size={15}/></button>
                        <button type="button" disabled={!loaded || saving} aria-label={t('common:delete')} onClick={() => setDeleting(item)}><Trash2 size={15}/></button></div>
                </li>)}</ul>
            </>}
            {deleting && <ConfirmModal title={tr('deleteConfirm')} description={deleting.title} actionLayout="horizontal" loading={saving} loadingValue="delete"
                options={[{value: 'cancel', label: t('common:cancel')}, {value: 'delete', label: t('common:delete'), variant: 'danger'}]}
                onClose={() => {if (!saving) setDeleting(null);}} onSelect={value => {if (value === 'delete') void persist(items.filter(item => item.id !== deleting.id)); else setDeleting(null);}}/>}
        </section>
    </ModalOverlay>;
}
