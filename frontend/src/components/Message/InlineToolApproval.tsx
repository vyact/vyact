import {useEffect, useMemo, useState} from 'react';
import {Check, ShieldAlert, X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import {api} from '../../services/api';
import './InlineToolApproval.css';

interface ApprovalRequest {
    approval_id: string;
    conversation_id?: string;
    project_id?: string;
    name: string;
    args: Record<string, unknown>;
    risk: string;
}

interface InlineToolApprovalProps {
    conversationId?: string;
}

const InlineToolApproval = ({conversationId}: InlineToolApprovalProps) => {
    const {t} = useTranslation('main');
    const [requests, setRequests] = useState<ApprovalRequest[]>([]);

    useEffect(() => {
        const receiveRequest = (event: Event) => {
            const request = (event as CustomEvent<ApprovalRequest>).detail;
            setRequests(current => current.some(item => item.approval_id === request.approval_id)
                ? current : [...current, request]);
        };
        window.addEventListener('vyact:tool-approval-required', receiveRequest);
        return () => window.removeEventListener('vyact:tool-approval-required', receiveRequest);
    }, []);

    const visibleRequests = useMemo(
        () => requests.filter(request => !request.conversation_id || request.conversation_id === conversationId),
        [conversationId, requests],
    );

    const resolve = async (request: ApprovalRequest, approved: boolean) => {
        await api.resolveToolApproval(request.approval_id, approved);
        setRequests(current => current.filter(item => item.approval_id !== request.approval_id));
    };

    if (!visibleRequests.length) return null;

    return <div className="inline-tool-approval-cards">
        {visibleRequests.map(request => <section className="inline-tool-approval-card" key={request.approval_id}>
            <div className="inline-tool-approval-card__icon"><ShieldAlert size={18}/></div>
            <div className="inline-tool-approval-card__content">
                <strong>{t('approval.requestTitle')}</strong>
                <span>{t('approval.toolRequest', {tool: request.name})}</span>
                <code>{JSON.stringify(request.args)}</code>
            </div>
            <div className="inline-tool-approval-card__actions">
                <button type="button" onClick={() => resolve(request, false)}>
                    <X size={15}/>{t('approval.reject')}
                </button>
                <button type="button" className="approve" onClick={() => resolve(request, true)}>
                    <Check size={15}/>{t('approval.approve')}
                </button>
            </div>
        </section>)}
    </div>;
};

export default InlineToolApproval;
