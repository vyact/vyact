import {useEffect, useRef, useState} from 'react';
import {Check, CircleHelp, Shield, ShieldAlert, ShieldCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {resolveApprovalMode, saveApprovalMode, type ApprovalMode} from '../../services/approvalPolicy';
import './ApprovalControl.css';

const MODE_OPTIONS: ApprovalMode[] = ['always_confirm', 'risky_only', 'trusted'];

const ApprovalControl = () => {
    const {t} = useTranslation('main');
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<ApprovalMode>(resolveApprovalMode);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const refresh = () => setMode(resolveApprovalMode());
        refresh();
        window.addEventListener('vyact:approval-policy-changed', refresh);
        return () => window.removeEventListener('vyact:approval-policy-changed', refresh);
    }, []);

    useEffect(() => {
        if (!open) return;
        const close = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
        };
        document.addEventListener('pointerdown', close);
        return () => document.removeEventListener('pointerdown', close);
    }, [open]);

    const selectMode = (nextMode: ApprovalMode) => {
        saveApprovalMode(nextMode);
        setMode(nextMode);
    };
    const ShieldIcon = mode === 'trusted' ? ShieldAlert : mode === 'risky_only' ? ShieldCheck : Shield;

    return <div className="approval-control-wrap">
        <div className="approval-control" ref={rootRef}>
            <button className={`approval-control__trigger mode-${mode}`} type="button" onClick={() => setOpen(value => !value)} aria-label={t('approval.title')}>
                <ShieldIcon size={17}/>
            </button>
            {open && <div className="approval-control__popover">
                <div className="approval-control__modes">{MODE_OPTIONS.map(option => <div className="approval-control__mode" key={option}>
                    <span className="approval-control__help" tabIndex={0} aria-label={t(`approval.modes.${option}.description`)}>
                        <CircleHelp size={16}/>
                        <span className="approval-control__tooltip" role="tooltip">{t(`approval.modes.${option}.description`)}</span>
                    </span>
                    <button type="button" onClick={() => selectMode(option)} className={mode === option ? 'selected' : ''}>
                        <strong>{t(`approval.modes.${option}.title`)}</strong>
                        {mode === option && <Check size={16}/>} 
                    </button>
                </div>)}</div>
            </div>}
        </div>
    </div>;
};

export default ApprovalControl;
