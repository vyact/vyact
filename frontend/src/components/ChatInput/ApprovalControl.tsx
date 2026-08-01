import {useEffect, useRef, useState} from 'react';
import {Check, CircleHelp, Shield, ShieldAlert, ShieldCheck, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import {resolveApprovalMode, saveApprovalMode, type ApprovalMode} from '../../services/approvalPolicy';
import './ApprovalControl.css';

interface ApprovalRequest {
    approval_id: string;
    conversation_id?: string;
    project_id?: string;
    name: string;
    args: Record<string, unknown>;
    risk: string;
}

interface ApprovalControlProps {
    conversationId?: string;
}

const MODE_OPTIONS: ApprovalMode[] = ['always_confirm', 'risky_only', 'trusted'];

const ApprovalControl = ({conversationId}: ApprovalControlProps) => {
    const {t} = useTranslation('main');
    const [open, setOpen] = useState(false);
    const [mode, setMode] = useState<ApprovalMode>(resolveApprovalMode);
    const [requests, setRequests] = useState<ApprovalRequest[]>([]);
    const rootRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const refresh = () => setMode(resolveApprovalMode());
        refresh();
        window.addEventListener('vyact:approval-policy-changed', refresh);
        return () => window.removeEventListener('vyact:approval-policy-changed', refresh);
    }, []);

    useEffect(() => {
        const receiveRequest = (event: Event) => {
            const request = (event as CustomEvent<ApprovalRequest>).detail;
            setRequests(current => current.some(item => item.approval_id === request.approval_id)
                ? current : [...current, request]);
        };
        window.addEventListener('vyact:tool-approval-required', receiveRequest);
        return () => window.removeEventListener('vyact:tool-approval-required', receiveRequest);
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
    const resolve = async (request: ApprovalRequest, approved: boolean) => {
        await api.resolveToolApproval(request.approval_id, approved);
        setRequests(current => current.filter(item => item.approval_id !== request.approval_id));
    };
    const visibleRequests = requests.filter(request => !request.conversation_id || request.conversation_id === conversationId);
    const ShieldIcon = mode === 'trusted' ? ShieldAlert : mode === 'risky_only' ? ShieldCheck : Shield;

    return <div className="approval-control-wrap">
        {visibleRequests.length > 0 && <div className="tool-approval-cards">
            {visibleRequests.map(request => <div className="tool-approval-card" key={request.approval_id}>
                <div className="tool-approval-card__icon"><ShieldAlert size={18}/></div>
                <div className="tool-approval-card__content">
                    <strong>{t('approval.requestTitle')}</strong>
                    <span>{t('approval.toolRequest', {tool: request.name})}</span>
                    <code>{JSON.stringify(request.args)}</code>
                </div>
                <div className="tool-approval-card__actions">
                    <button onClick={() => resolve(request, false)}><X size={15}/>{t('approval.reject')}</button>
                    <button className="approve" onClick={() => resolve(request, true)}><Check size={15}/>{t('approval.approve')}</button>
                </div>
            </div>)}
        </div>}
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
