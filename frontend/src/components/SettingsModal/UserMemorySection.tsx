import {useEffect, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import CustomSelect from '../CustomSelect/CustomSelect';
import {
    createUserMemory, deleteAllUserMemories, deleteUserMemory, getUserMemories,
    refreshUserMemories, setUserMemoryEnabled, updateUserMemory,
} from '../../services/userMemory';
import type {UserMemory, UserMemoryInput} from '../../services/userMemory';
import './UserMemorySection.css';

const MEMORY_TYPES = [
    'PROFILE', 'PREFERENCE', 'PROJECT', 'LEARNING', 'DECISION', 'WORKFLOW', 'LONG_TERM_GOAL',
] as const;

const EMPTY_DRAFT: UserMemoryInput = {memory_type: 'PREFERENCE', category: '', content: ''};

export default function UserMemorySection() {
    const {t} = useTranslation('settings');
    const [memories, setMemories] = useState<UserMemory[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<UserMemoryInput>(EMPTY_DRAFT);
    const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);

    useEffect(() => {
        let active = true;
        getUserMemories().then(result => {
            if (active) {
                setMemories(result.memories);
                setEnabled(result.enabled);
            }
        }).catch(() => {
            if (active) toast.error(t('memory.loadFailed'));
        }).finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, [t]);

    const reload = async () => {
        const result = await getUserMemories();
        setMemories(result.memories);
        setEnabled(result.enabled);
    };

    const run = async (action: () => Promise<void>, successKey?: string) => {
        if (busy) return;
        setBusy(true);
        try {
            await action();
            await reload();
            if (successKey) toast.success(t(successKey));
        } catch {
            toast.error(t('memory.actionFailed'));
        } finally {
            setBusy(false);
        }
    };

    const beginEdit = (memory?: UserMemory) => {
        setEditingId(memory?.id ?? 'new');
        setDraft(memory ? {
            memory_type: memory.memory_type,
            category: memory.category,
            content: memory.content,
        } : {...EMPTY_DRAFT});
    };

    const saveDraft = () => void run(async () => {
        if (editingId === 'new') await createUserMemory(draft);
        else if (editingId) await updateUserMemory(editingId, draft);
        setEditingId(null);
    }, 'memory.saved');

    const analyze = () => void run(async () => {
        const result = await refreshUserMemories();
        toast.success(result.processed
            ? t('memory.analysisComplete', {count: result.changed})
            : t('memory.noNewConversations'));
    });

    return <section className="user-memory-section" aria-label={t('memory.title')}>
        <div className="user-memory-heading">
            <div>
                <h3>{t('memory.title')}</h3>
                <p>{t('memory.description')}</p>
            </div>
            <ToggleSwitch checked={enabled} disabled={busy || loading} label={t('memory.enabled')}
                          onChange={checked => void run(async () => { await setUserMemoryEnabled(checked); })}/>
        </div>
        <div className="user-memory-actions">
            <button type="button" className="remember-edit-btn" disabled={busy || loading}
                    onClick={() => beginEdit()}>{t('memory.add')}</button>
            <button type="button" className="remember-start-btn" disabled={busy || loading || !enabled}
                    onClick={analyze}>{busy ? t('memory.working') : t('memory.analyze')}</button>
        </div>
        {editingId && <div className="user-memory-editor">
            <div className="user-memory-type-field"><span>{t('memory.type')}</span>
                <CustomSelect value={draft.memory_type} disabled={busy}
                              options={MEMORY_TYPES.map(type => ({value: type, label: t(`memory.types.${type}`)}))}
                              onChange={value => setDraft({...draft, memory_type: value})}/>
            </div>
            <label>{t('memory.category')}
                <input value={draft.category} maxLength={80} disabled={busy}
                       onChange={event => setDraft({...draft, category: event.target.value})}/>
            </label>
            <label>{t('memory.content')}
                <textarea value={draft.content} maxLength={500} disabled={busy}
                          onChange={event => setDraft({...draft, content: event.target.value})}/>
            </label>
            <div className="user-memory-item-actions">
                <button type="button" className="remember-cancel-btn" disabled={busy}
                        onClick={() => setEditingId(null)}>{t('common:cancel')}</button>
                <button type="button" className="remember-start-btn" disabled={busy || !draft.content.trim()}
                        onClick={saveDraft}>{t('common:save')}</button>
            </div>
        </div>}
        <div className="user-memory-list">
            {loading ? <p>{t('profile.checking')}</p> : memories.length === 0
                ? <p>{t('memory.empty')}</p>
                : memories.map(memory => <div className="user-memory-item" key={memory.id}>
                    <div className="user-memory-item-header">
                        <span>{t(`memory.types.${memory.memory_type}`)}</span>
                        {memory.category && <span>{memory.category}</span>}
                    </div>
                    <p>{memory.content}</p>
                    <div className="user-memory-item-actions">
                        <button type="button" disabled={busy} onClick={() => beginEdit(memory)}>{t('common:edit')}</button>
                        <button type="button" disabled={busy} onClick={() => void run(async () => {
                            await deleteUserMemory(memory.id);
                        }, 'memory.deleted')}>{t('common:delete')}</button>
                    </div>
                </div>)}
        </div>
        {memories.length > 0 && <div className="user-memory-delete-all">
            {confirmDeleteAll ? <>
                <span>{t('memory.deleteAllConfirm')}</span>
                <button type="button" disabled={busy} onClick={() => setConfirmDeleteAll(false)}>{t('common:cancel')}</button>
                <button type="button" disabled={busy} onClick={() => void run(async () => {
                    await deleteAllUserMemories();
                    setConfirmDeleteAll(false);
                }, 'memory.deleted')}>{t('memory.deleteAll')}</button>
            </> : <button type="button" disabled={busy} onClick={() => setConfirmDeleteAll(true)}>
                {t('memory.deleteAll')}
            </button>}
        </div>}
    </section>;
}
