import {useState} from 'react';
import {ChevronDown, FileSearch, RotateCcw} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {CodeChanges} from '../../types';
import {useCodePanel} from '../../contexts/CodePanelContext';
import {toast} from '../common/ToastNotifications/ToastNotifications';

const INITIAL_VISIBLE_FILES = 3;

const CodeChangesCard = ({changes}: {changes: CodeChanges}) => {
    const {t} = useTranslation('main');
    const {openPanel} = useCodePanel();
    const [expanded, setExpanded] = useState(false);
    const [undoing, setUndoing] = useState(false);
    const [undone, setUndone] = useState(false);
    const visibleFiles = expanded ? changes.files : changes.files.slice(0, INITIAL_VISIBLE_FILES);
    const [reviewViewerId] = useState(() => `code-changes-${crypto.randomUUID()}`);

    const review = () => {
        openPanel(changes.files.map(file => ({
            name: file.path,
            lang: file.path.split('.').pop() || 'text',
            code: file.diff,
            mode: 'diff',
            additions: file.additions,
            deletions: file.deletions,
        })), 0, reviewViewerId);
    };

    const undo = async () => {
        if (!changes.undoToken || undoing || undone) return;
        setUndoing(true);
        try {
            const response = await fetch('/api/code-changes/undo', {
                method: 'POST',
                headers: {'Content-Type': 'application/json'},
                body: JSON.stringify({undo_token: changes.undoToken}),
            });
            if (!response.ok) throw new Error(response.status === 409 ? t('message.codeChangesUndoConflict') : t('message.codeChangesUndoFailed'));
            setUndone(true);
            toast.success(t('message.codeChangesUndone'));
        } catch (error) {
            toast.error(error instanceof Error ? error.message : t('message.codeChangesUndoFailed'));
        } finally {
            setUndoing(false);
        }
    };

    return <section className={`code-changes-card${undone ? ' undone' : ''}`}>
        <header className="code-changes-header">
            <div>
                <strong>{t('message.codeChangesTitle', {count: changes.files.length})}</strong>
                <span className="code-changes-total"><b>+{changes.additions}</b> <i>-{changes.deletions}</i></span>
            </div>
            <div className="code-changes-actions">
                {changes.undoToken && <button type="button" onClick={undo} disabled={undoing || undone}>
                    <RotateCcw size={15}/>{undone ? t('message.codeChangesUndone') : undoing ? t('message.codeChangesUndoing') : t('message.codeChangesUndo')}
                </button>}
                <button className="code-changes-review" type="button" onClick={review}>
                    <FileSearch size={15}/>{t('message.codeChangesReview')}
                </button>
            </div>
        </header>
        <div className="code-changes-files">
            {visibleFiles.map(file => <div className="code-change-file" key={`${file.folderId}:${file.path}`}>
                <div className="code-change-file-row">
                    <span>{file.path}</span>
                    <span className="code-change-count"><b>+{file.additions}</b> <i>-{file.deletions}</i></span>
                </div>
                <pre className="code-change-preview" aria-label={t('message.codeChangesPreview', {path: file.path})}>
                    {file.diff.split('\n').map((line, index) => <code className={line.startsWith('+') ? 'added' : line.startsWith('-') ? 'deleted' : ''} key={index}>{line || ' '}</code>)}
                </pre>
            </div>)}
        </div>
        {changes.files.length > INITIAL_VISIBLE_FILES && <button className="code-changes-more" type="button" onClick={() => setExpanded(value => !value)}>
            {expanded ? t('message.codeChangesCollapse') : t('message.codeChangesMore', {count: changes.files.length - INITIAL_VISIBLE_FILES})}<ChevronDown className={expanded ? 'expanded' : ''} size={16}/>
        </button>}
    </section>;
};

export default CodeChangesCard;
