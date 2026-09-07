import ModelStorageProgressOverlay from './ModelStorageProgressOverlay';
import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {FolderOpen, RotateCcw} from 'lucide-react';
import ConfirmModal from '../ConfirmModal/ConfirmModal';
import {modelStorage, type ModelStoragePlan, type ModelStorageStatus} from '../../../services/modelStorage';
import {formatModelBytes} from '../../../utils/vyactModelDisplay';
import './ModelStorageLocation.css';

interface Props {
    disabled?: boolean;
    confirmChanges?: boolean;
    onBusyChange?: (busy: boolean) => void;
    onChanged?: () => void | Promise<void>;
}
const POLL_MS = 750;
export default function ModelStorageLocation({disabled, confirmChanges = true, onBusyChange, onChanged}: Props) {
    const {t} = useTranslation('common');
    const [surface, setSurface] = useState<HTMLElement | null>(null);
    const bindSurface = useCallback((node: HTMLElement | null) => {
        setSurface(node?.closest<HTMLElement>('[data-model-storage-surface]') ?? null);
    }, []);
    const [status, setStatus] = useState<ModelStorageStatus | null>(null);
    const [plan, setPlan] = useState<ModelStoragePlan | null>(null);
    const [working, setWorking] = useState(false);
    const [error, setError] = useState('');
    const [connectionFailed, setConnectionFailed] = useState(false);
    const callbacks = useRef({onBusyChange, onChanged});
    useEffect(() => {callbacks.current = {onBusyChange, onChanged};}, [onBusyChange, onChanged]);
    const wasMoving = useRef(false);
    const busy = working || Boolean(status?.busy);
    useEffect(() => {callbacks.current.onBusyChange?.(busy);}, [busy]);
    useEffect(() => {
        let disposed = false;
        let timer: ReturnType<typeof setTimeout>;
        const poll = async () => {
            try {
                const current = await modelStorage.status();
                if (disposed) return;
                setStatus(current);
                setConnectionFailed(false);
                if (wasMoving.current && !current.busy) {
                    setPlan(null);
                    if (current.phase === 'complete') {
                        void Promise.resolve(callbacks.current.onChanged?.()).catch(() => setError('storage_failed'));
                    }
                }
                wasMoving.current = current.busy;
            } catch {if (!disposed) setConnectionFailed(true);}
            if (!disposed) timer = setTimeout(() => void poll(), POLL_MS);
        };
        void poll();
        return () => {disposed = true; clearTimeout(timer);};
    }, []);
    const message = (code: string) => t(`modelStorage.${code}`, {defaultValue: t('modelStorage.storage_failed')});
    const select = async (targetDirectory?: string) => {
        setError('');
        setWorking(true);
        try {
            const path = targetDirectory ?? await window.ragAPI?.selectFolder?.(t('modelStorage.title'), status?.parent_directory);
            if (!path) return;
            const next = await modelStorage.plan(path);
            if (!next.same) {
                if (confirmChanges) setPlan(next);
                else await move(next);
            }
        } catch (reason) {setError(reason instanceof Error ? reason.message : 'storage_failed');}
        finally {setWorking(false);}
    };
    const move = async (selectedPlan: ModelStoragePlan) => {
        setWorking(true);
        setError('');
        try {
            const result = await modelStorage.move(selectedPlan.selected_directory);
            if (!result.same) {
                wasMoving.current = true;
                setStatus(current => current ? {...current, busy: true, phase: 'preparing', copied_bytes: 0, total_bytes: selectedPlan.total_bytes, current_file: undefined} : current);
            }
            setStatus(await modelStorage.status());
            setPlan(null);
        } catch (reason) {setError(reason instanceof Error ? reason.message : 'storage_failed'); setPlan(null);}
        finally {setWorking(false);}
    };
    return <section ref={bindSurface} className="model-storage-location" aria-busy={busy}>
        <div className="model-storage-row">
            <span className="model-storage-label">{t('modelStorage.title')}</span>
            <div className="model-storage-path-row"><FolderOpen size={17} aria-hidden="true"/><span className="model-storage-path">{status?.path || t('loading')}</span></div>
            <div className="model-storage-actions">
                {status?.is_default === false && status.default_directory && <button type="button" className="model-storage-restore"
                    onClick={() => void select(status.default_directory)} disabled={disabled || busy}>
                    <RotateCcw size={14} aria-hidden="true"/>{t('modelStorage.restoreDefault')}
                </button>}
            <button type="button" onClick={() => void select()}
                disabled={disabled || busy || !status || !window.ragAPI?.selectFolder}>{t('modelStorage.change')}</button>
            </div>
        </div>
        {status?.busy && surface && <ModelStorageProgressOverlay surface={surface} status={status}/>}
        {(error || connectionFailed || status?.phase === 'error') && <p className="model-storage-error" role="alert">{message(error || status?.error || 'storage_failed')}</p>}
        {!busy && status?.phase === 'complete' && status.warning && <p role="status">{message(status.warning)}</p>}
        {!window.ragAPI?.selectFolder && <p>{t('modelStorage.desktopOnly')}</p>}
        {plan && <ConfirmModal title={t('modelStorage.confirmTitle')} description={t('modelStorage.confirmDescription')}
            details={[plan.destination, t('modelStorage.size', {size: formatModelBytes(plan.total_bytes)})]}
            options={[{label: t('cancel'), value: 'cancel'}, {label: t('modelStorage.move'), value: 'move', variant: 'primary'}]}
            actionLayout="horizontal" loading={working} loadingValue="move"
            onClose={() => setPlan(null)} onSelect={value => value === 'move' ? void move(plan) : setPlan(null)}/>}
    </section>;
}
