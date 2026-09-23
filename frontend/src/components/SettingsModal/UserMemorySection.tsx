import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {ChevronDown, Trash2} from 'lucide-react';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';
import {toast} from '../common/ToastNotifications/ToastNotifications';
import ToggleSwitch from '../common/ToggleSwitch/ToggleSwitch';
import {
    deleteAllUserMemories, deleteUserMemory, getUserMemories,
    refreshUserMemories, setUserMemoryEnabled,
} from '../../services/userMemory';
import type {UserMemory, UserMemoryProgress} from '../../services/userMemory';
import './UserMemorySection.css';

function UserMemoryItem({memory, busy, onDelete}: {
    memory: UserMemory;
    busy: boolean;
    onDelete: () => void;
}) {
    const {t} = useTranslation('settings');
    const contentRef = useRef<HTMLParagraphElement>(null);
    const [expanded, setExpanded] = useState(false);
    const [hasOverflow, setHasOverflow] = useState(false);

    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!content || expanded) return;
        const measure = () => setHasOverflow(content.scrollWidth > content.clientWidth + 1);
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(content);
        return () => observer.disconnect();
    }, [expanded, memory.content]);

    return <div className={`user-memory-item${hasOverflow ? ' is-expandable' : ''}`}
                onClick={() => { if (hasOverflow) setExpanded(value => !value); }}>
        <div className="user-memory-item-top">
            <div className="user-memory-item-header">
                <span>{t(`memory.types.${memory.memory_type}`)}</span>
                {memory.category && <span>{memory.category}</span>}
            </div>
            <div className="user-memory-item-actions">
                <button type="button" className="user-memory-icon-button is-danger" disabled={busy}
                        aria-label={t('common:delete')} onClick={event => {
                            event.stopPropagation();
                            onDelete();
                        }}>
                    <Trash2 size={16} aria-hidden="true"/>
                </button>
            </div>
        </div>
        <div className="user-memory-content-row">
            <p ref={contentRef} className={expanded ? 'is-expanded' : ''} id={`user-memory-content-${memory.id}`}>
                {memory.content}
            </p>
            {hasOverflow && <span className={`user-memory-expand-icon${expanded ? ' is-expanded' : ''}`}
                                  aria-hidden="true">
                <ChevronDown size={16} aria-hidden="true"/>
            </span>}
        </div>
    </div>;
}

export default function UserMemorySection() {
    const {t} = useTranslation('settings');
    const [memories, setMemories] = useState<UserMemory[]>([]);
    const [enabled, setEnabled] = useState(true);
    const [loading, setLoading] = useState(true);
    const [busy, setBusy] = useState(false);
    const [analyzing, setAnalyzing] = useState(false);
    const [analysisProgress, setAnalysisProgress] = useState<UserMemoryProgress | null>(null);
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

    const analyze = async () => {
        if (busy) return;
        setBusy(true);
        setAnalyzing(true);
        setAnalysisProgress({processed: 0, total: 0, title: ''});
        try {
            const result = await refreshUserMemories(setAnalysisProgress);
            await reload();
            toast.success(result.processed
                ? t('memory.analysisComplete', {count: result.changed})
                : t('memory.noNewConversations'));
        } catch (error) {
            const code = error instanceof Error ? error.message : '';
            toast.error(t(code === 'busy' ? 'memory.alreadyRunning'
                : code === 'disabled' ? 'memory.disabledError' : 'memory.actionFailed'));
        } finally {
            setBusy(false);
            setAnalyzing(false);
            setAnalysisProgress(null);
        }
    };

    return <section className="user-memory-section" aria-label={t('memory.title')}>
        <div className="user-memory-heading">
            <div className="user-memory-heading-copy">
                <h3>{t('memory.title')}</h3>
                <p>{t('memory.description')}</p>
            </div>
            <ToggleSwitch checked={enabled} disabled={busy || loading} label={t('memory.enabled')}
                          onChange={checked => void run(async () => { await setUserMemoryEnabled(checked); })}/>
        </div>
        <div className="user-memory-toolbar">
            {memories.length > 0 && <button type="button" className="user-memory-delete-all-button"
                                             disabled={busy || loading} onClick={() => setConfirmDeleteAll(true)}>
                {t('memory.deleteAll')}
            </button>}
            <button type="button" className="remember-start-btn" disabled={busy || loading || !enabled}
                    onClick={() => void analyze()}>{analyzing ? t('memory.working') : t('memory.analyze')}</button>
        </div>
        {analyzing && analysisProgress && <div className="remember-progress user-memory-progress" aria-live="polite">
            <div className="remember-status">
                {analysisProgress.total > 0
                    ? t('memory.progress', {processed: analysisProgress.processed, total: analysisProgress.total})
                    : t('memory.preparing')}
            </div>
            {analysisProgress.total > 0 && <div className="remember-bar-wrap" role="progressbar"
                                                   aria-valuemin={0} aria-valuemax={analysisProgress.total}
                                                   aria-valuenow={analysisProgress.processed}>
                <div className="remember-bar" style={{width: `${Math.min(100, analysisProgress.processed / analysisProgress.total * 100)}%`}}/>
            </div>}
            {analysisProgress.title && <div className="remember-count remember-cur-title">
                {analysisProgress.batch_size && analysisProgress.batch_size > 1
                    ? t('memory.currentBatch', {title: analysisProgress.title, count: analysisProgress.batch_size - 1})
                    : t('memory.currentConversation', {title: analysisProgress.title})}
            </div>}
            <div className="remember-spinner"/>
        </div>}
        <div className={`user-memory-list${!loading && memories.length === 0 ? ' is-empty' : ''}`}>
            {loading ? <p>{t('profile.checking')}</p> : memories.length === 0
                ? <p>{t('memory.empty')}</p>
                : memories.map(memory => <UserMemoryItem key={memory.id} memory={memory} busy={busy}
                    onDelete={() => void run(async () => {
                        await deleteUserMemory(memory.id);
                    }, 'memory.deleted')}/>)}
        </div>
        {confirmDeleteAll && <ConfirmModal className="user-memory-delete-dialog" title={t('memory.deleteAll')}
                                           description={t('memory.deleteAllConfirm')}
                                           options={[
                                               {label: t('common:cancel'), value: 'cancel'},
                                               {label: t('memory.deleteAll'), value: 'delete', variant: 'danger'},
                                           ]} actionLayout="horizontal"
                                           onClose={() => setConfirmDeleteAll(false)}
                                           onSelect={value => {
                                               setConfirmDeleteAll(false);
                                               if (value === 'delete') void run(async () => { await deleteAllUserMemories(); }, 'memory.deleted');
                                           }}/>}
    </section>;
}
