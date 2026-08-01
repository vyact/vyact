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

const MULTILINE_ARGUMENT_KEYS = new Set(['content', 'patch', 'old_string', 'new_string']);
const ARGUMENT_PRIORITY = [
    'folder_id', 'path', 'file_path', 'filename', 'source', 'destination',
    'working_directory', 'task', 'check', 'pattern', 'query',
    'old_string', 'new_string', 'patch', 'content',
];

function formatArgumentValue(value: unknown): string {
    if (typeof value === 'string') return value || '—';
    if (value === null || value === undefined) return '—';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
}

function orderedArguments(args: Record<string, unknown>): Array<[string, unknown]> {
    const priorityByKey = new Map(ARGUMENT_PRIORITY.map((key, index) => [key, index]));
    return Object.entries(args).sort(([leftKey], [rightKey]) => {
        const leftPriority = priorityByKey.get(leftKey) ?? ARGUMENT_PRIORITY.length;
        const rightPriority = priorityByKey.get(rightKey) ?? ARGUMENT_PRIORITY.length;
        return leftPriority - rightPriority;
    });
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
                <dl className="inline-tool-approval-card__arguments">
                    {orderedArguments(request.args).map(([key, value]) => {
                        const formattedValue = formatArgumentValue(value);
                        const multiline = MULTILINE_ARGUMENT_KEYS.has(key) || formattedValue.includes('\n');
                        return <div className={multiline ? 'multiline' : ''} key={key}>
                            <dt>{t(`approval.argumentLabels.${key}`, {defaultValue: key})}</dt>
                            <dd>{multiline
                                ? <pre>{formattedValue}</pre>
                                : <code>{formattedValue}</code>}
                            </dd>
                        </div>;
                    })}
                </dl>
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
