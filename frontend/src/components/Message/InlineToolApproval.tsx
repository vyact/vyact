import {useEffect, useMemo, useState} from 'react';
import {Check, ShieldAlert, UserRoundCheck, X} from 'lucide-react';
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
    const [answers, setAnswers] = useState<Record<string, string>>({});

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

    const resolve = async (request: ApprovalRequest, approved: boolean, answer = '') => {
        await api.resolveToolApproval(request.approval_id, approved, answer);
        setRequests(current => current.filter(item => item.approval_id !== request.approval_id));
        setAnswers(current => {
            const next = {...current};
            delete next[request.approval_id];
            return next;
        });
    };

    if (!visibleRequests.length) return null;

    return <div className="inline-tool-approval-cards">
        {visibleRequests.map(request => {
            const isBrowserUserAction = request.name.split('__').slice(-1)[0] === 'browser_wait_for_user';
            const isBrowserQuestion = request.name.split('__').slice(-1)[0] === 'browser_ask_user';
            const action = typeof request.args.action === 'string' ? request.args.action : 'other';
            const instructions = typeof request.args.instructions === 'string' ? request.args.instructions : '';
            const question = typeof request.args.question === 'string' ? request.args.question : '';
            const options = Array.isArray(request.args.options) ? request.args.options.filter((item): item is string => typeof item === 'string') : [];
            const isBrowserInteraction = isBrowserUserAction || isBrowserQuestion;
            const answer = answers[request.approval_id] || '';
            return <section className={`inline-tool-approval-card${isBrowserInteraction ? ' browser-user-action' : ''}`} key={request.approval_id}>
            <div className="inline-tool-approval-card__icon">{isBrowserInteraction ? <UserRoundCheck size={18}/> : <ShieldAlert size={18}/>}</div>
            <div className="inline-tool-approval-card__content">
                <strong>{t(isBrowserQuestion ? 'approval.browserQuestionTitle' : isBrowserUserAction ? 'approval.browserUserActionTitle' : 'approval.requestTitle')}</strong>
                <span>{isBrowserQuestion ? question : isBrowserUserAction
                    ? t(`approval.browserUserActions.${action}`, {defaultValue: t('approval.browserUserActions.other')})
                    : t('approval.toolRequest', {tool: request.name})}</span>
                {isBrowserUserAction && instructions && <p className="inline-tool-approval-card__instruction">{instructions}</p>}
                {isBrowserQuestion && (options.length > 0
                    ? <div className="inline-tool-approval-card__choices">{options.map(option => <button type="button" key={option} onClick={() => resolve(request, true, option)}>{option}</button>)}</div>
                    : <input className="inline-tool-approval-card__input" value={answer} autoFocus placeholder={t('approval.browserQuestionPlaceholder')} onChange={event => setAnswers(current => ({...current, [request.approval_id]: event.target.value}))} onKeyDown={event => { if (event.key === 'Enter' && answer.trim()) void resolve(request, true, answer); }}/>) }
                {!isBrowserInteraction && <dl className="inline-tool-approval-card__arguments">
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
                </dl>}
            </div>
            <div className="inline-tool-approval-card__actions">
                <button type="button" onClick={() => resolve(request, false)}>
                    <X size={15}/>{t(isBrowserInteraction ? 'approval.stopBrowserTask' : 'approval.reject')}
                </button>
                {!isBrowserQuestion && <button type="button" className="approve" onClick={() => resolve(request, true)}>
                    <Check size={15}/>{t(isBrowserUserAction ? 'approval.continueBrowserTask' : 'approval.approve')}</button>}
                {isBrowserQuestion && options.length === 0 && <button type="button" className="approve" disabled={!answer.trim()} onClick={() => resolve(request, true, answer)}>
                    <Check size={15}/>{t('approval.submitBrowserAnswer')}</button>}
            </div>
        </section>})}
    </div>;
};

export default InlineToolApproval;
