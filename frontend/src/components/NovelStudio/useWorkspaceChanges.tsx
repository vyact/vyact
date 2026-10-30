import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import ConfirmModal from '../common/ConfirmModal/ConfirmModal';

export interface WorkspaceEditSession {
    dirty: boolean;
    pending: boolean;
    validationError?: string;
    save: () => Promise<boolean>;
    discard: () => Promise<boolean>;
}

export default function useWorkspaceChanges(hasProposal: boolean, saving = false) {
    const {t} = useTranslation('main');
    const session = useRef<WorkspaceEditSession | null>(null);
    const [dirty, setDirty] = useState(false);
    const [pending, setPending] = useState(false);
    const [action, setAction] = useState<(() => void) | null>(null);
    const [resolving, setResolving] = useState(false);
    const [failed, setFailed] = useState(false);
    const registerSession = useCallback((value: WorkspaceEditSession | null) => {
        session.current = value;
        setDirty(value?.dirty ?? false);
        setPending(value?.pending ?? false);
    }, []);
    const requestAction = (next: () => void) => {
        if (pending || resolving) return;
        if (dirty || hasProposal) {setFailed(false); setAction(() => next);}
        else next();
    };
    useEffect(() => {
        if (!dirty && !hasProposal && !pending && !saving) return;
        const warn = (event: BeforeUnloadEvent) => {event.preventDefault(); event.returnValue = '';};
        window.addEventListener('beforeunload', warn);
        return () => window.removeEventListener('beforeunload', warn);
    }, [dirty, hasProposal, pending, saving]);
    const confirmation = action ? <ConfirmModal className="unsaved-changes-dialog" actionLayout="horizontal" title={t(`novelStudio.changes.${dirty ? 'title' : 'proposalTitle'}`)}
        description={t(`novelStudio.changes.${dirty ? 'description' : 'proposalDescription'}`)}
        details={failed ? [session.current?.validationError ?? t('novelStudio.saveError')] : undefined}
        loading={resolving} onClose={() => {if (!resolving) setAction(null);}}
        options={[{label: t('novelStudio.changes.cancel'), value: 'cancel'},
            {label: t('novelStudio.changes.discardContinue'), value: 'discard'},
            ...(dirty ? [{label: t('novelStudio.changes.saveContinue'), value: 'save', variant: 'primary' as const}] : [])]}
        onSelect={value => {
            if (resolving) return;
            if (value === 'cancel') {setAction(null); return;}
            setResolving(true);
            void (async () => {
                try {
                    const editor = session.current;
                    const success = !editor || await (value === 'save' ? editor.save() : editor.discard());
                    if (!success) {setFailed(true); return;}
                    setAction(null); action();
                } catch {setFailed(true);
                } finally {setResolving(false);}
            })();
        }}/> : null;
    return {session, dirty, pending, registerSession, requestAction, confirmation};
}
