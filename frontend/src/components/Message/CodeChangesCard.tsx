import {useEffect, useRef, useState} from 'react';
import {ChevronDown, FileSearch, RotateCcw} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {CodeChanges} from '../../types';
import {useCodePanel} from '../../contexts/CodePanelContext';
import {toast} from '../common/ToastNotifications/ToastNotifications';

const INITIAL_VISIBLE_FILES = 3;
const PREVIEW_HOVER_DELAY_MS = 2000;

const CodeChangesCard = ({changes}: {changes: CodeChanges}) => {
    const {t} = useTranslation('main');
    const {openPanel} = useCodePanel();
    const [expanded, setExpanded] = useState(false);
    const [undoing, setUndoing] = useState(false);
    const [undone, setUndone] = useState(false);
    const [undoAvailable, setUndoAvailable] = useState<boolean | null>(changes.undoToken ? null : false);
    const [undoingFileKey, setUndoingFileKey] = useState<string | null>(null);
    const [undoneFileKeys, setUndoneFileKeys] = useState<Set<string>>(() => new Set());
    const [activePreviewKey, setActivePreviewKey] = useState<string | null>(null);
    const previewSessionActiveRef = useRef(false);
    const previewTimerRef = useRef<number | null>(null);
    const visibleFiles = expanded ? changes.files : changes.files.slice(0, INITIAL_VISIBLE_FILES);
    const [reviewViewerId] = useState(() => `code-changes-${crypto.randomUUID()}`);

    const toReviewFile = (file: CodeChanges['files'][number]) => ({
        name: file.path,
        lang: file.path.split('.').pop() || 'text',
        code: file.diff,
        mode: 'diff' as const,
        additions: file.additions,
        deletions: file.deletions,
    });

    const review = () => {
        openPanel(changes.files.map(toReviewFile), 0, reviewViewerId);
    };

    const clearPreviewTimer = () => {
        if (previewTimerRef.current !== null) {
            window.clearTimeout(previewTimerRef.current);
            previewTimerRef.current = null;
        }
    };

    const showPreview = (previewKey: string, immediately = false) => {
        clearPreviewTimer();
        if (immediately || previewSessionActiveRef.current) {
            previewSessionActiveRef.current = true;
            setActivePreviewKey(previewKey);
            return;
        }
        previewTimerRef.current = window.setTimeout(() => {
            previewSessionActiveRef.current = true;
            setActivePreviewKey(previewKey);
            previewTimerRef.current = null;
        }, PREVIEW_HOVER_DELAY_MS);
    };

    const closePreviewSession = () => {
        clearPreviewTimer();
        previewSessionActiveRef.current = false;
        setActivePreviewKey(null);
    };

    useEffect(() => () => clearPreviewTimer(), []);

    useEffect(() => {
        if (!changes.undoToken) return;
        let cancelled = false;
        fetch(`/api/code-changes/undo/${encodeURIComponent(changes.undoToken)}/status`)
            .then(response => response.ok ? response.json() : Promise.reject())
            .then(status => {
                if (cancelled) return;
                setUndoAvailable(Boolean(status.available));
                setUndone(Boolean(status.complete));
                setUndoneFileKeys(new Set((status.undoneFiles || []).map(
                    (file: {folderId: string; path: string}) => `${file.folderId}:${file.path}`,
                )));
            })
            .catch(() => {
                if (!cancelled) setUndoAvailable(false);
            });
        return () => {
            cancelled = true;
        };
    }, [changes.undoToken]);

    const undo = async (file?: CodeChanges['files'][number]) => {
        if (!changes.undoToken || undoing || undone || undoingFileKey) return;
        const fileKey = file ? `${file.folderId}:${file.path}` : null;
        if (fileKey && undoneFileKeys.has(fileKey)) return;
        if (fileKey) setUndoingFileKey(fileKey);
        else setUndoing(true);
        try {
            const response = await fetch('/api/code-changes/undo', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({
                    undo_token: changes.undoToken,
                    ...(file ? {folder_id: file.folderId, path: file.path} : {}),
                }),
            });
            if (!response.ok) throw new Error(response.status === 409 ? t('message.codeChangesUndoConflict') : t('message.codeChangesUndoFailed'));
            const result = await response.json();
            if (fileKey) {
                setUndoneFileKeys(current => new Set(current).add(fileKey));
            } else {
                setUndoneFileKeys(new Set(changes.files.map(item => `${item.folderId}:${item.path}`)));
            }
            if (result.complete) setUndone(true);
            setUndoAvailable(!result.complete);
            toast.success(t('message.codeChangesUndone'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('message.codeChangesUndoFailed'));
        } finally {
            if (fileKey) setUndoingFileKey(null);
            else setUndoing(false);
        }
    };

    return <section className={`code-changes-card${undone ? ' undone' : ''}`} onPointerLeave={closePreviewSession}>
        <header className="code-changes-header">
            <div>
                <strong>{t('message.codeChangesTitle', {count: changes.files.length})}</strong>
                <span className="code-changes-total"><b>+{changes.additions}</b> <i>-{changes.deletions}</i></span>
            </div>
            <div className="code-changes-actions">
                {changes.undoToken && (undone || undoAvailable !== false) && <button type="button" onClick={() => undo()} disabled={undoAvailable !== true || undoing || undone || Boolean(undoingFileKey)}>
                    <RotateCcw size={15}/>{undone ? t('message.codeChangesUndone') : undoing ? t('message.codeChangesUndoing') : t('message.codeChangesUndo')}
                </button>}
                <button className="code-changes-review" type="button" onClick={review}>
                    <FileSearch size={15}/>{t('message.codeChangesReview')}
                </button>
            </div>
        </header>
        <div className="code-changes-files">
            {visibleFiles.map(file => {
                const previewKey = `${file.folderId}:${file.path}`;
                const fileUndone = undoneFileKeys.has(previewKey);
                return <div
                    className={`code-change-file${fileUndone ? ' undone' : ''}`}
                    key={previewKey}
                    onPointerEnter={() => showPreview(previewKey)}
                    onFocus={() => showPreview(previewKey, true)}
                >
                <div
                    className={`code-change-file-row${activePreviewKey === previewKey ? ' active' : ''}`}
                    role="button"
                    tabIndex={0}
                    onClick={() => openPanel([toReviewFile(file)], 0, `${reviewViewerId}:${previewKey}`)}
                    onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            openPanel([toReviewFile(file)], 0, `${reviewViewerId}:${previewKey}`);
                        }
                    }}
                >
                    <span className="code-change-file-path">{file.path}</span>
                    <div className="code-change-file-actions">
                        <span className="code-change-count"><b>+{file.additions}</b> <i>-{file.deletions}</i></span>
                        {changes.undoToken && (fileUndone || undoAvailable !== false) && <button
                            className="code-change-file-undo"
                            type="button"
                            onClick={event => {
                                event.stopPropagation();
                                undo(file);
                            }}
                            onKeyDown={event => event.stopPropagation()}
                            disabled={fileUndone || undoing || Boolean(undoingFileKey)}
                        >
                            <RotateCcw size={14}/>
                        </button>}
                    </div>
                </div>
                <pre className={`code-change-preview${activePreviewKey === previewKey ? ' visible' : ''}`} aria-label={t('message.codeChangesPreview', {path: file.path})}>
                    {file.diff.split('\n').map((line, index) => <code className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'deleted' : ''} key={index}>{line || ' '}</code>)}
                </pre>
            </div>})}
        </div>
        {changes.files.length > INITIAL_VISIBLE_FILES && <button className="code-changes-more" type="button" onClick={() => setExpanded(value => !value)}>
            {expanded ? t('message.codeChangesCollapse') : t('message.codeChangesMore', {count: changes.files.length - INITIAL_VISIBLE_FILES})}<ChevronDown className={expanded ? 'expanded' : ''} size={16}/>
        </button>}
    </section>;
};

export default CodeChangesCard;
