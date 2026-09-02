import {useEffect, useState} from 'react';
import {Ban, BookOpen, ChevronDown, CircleCheck, CircleX, Sparkles} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ResponseProgressMessage, ToolActivity} from '../../types';
import {linkify, renderMarkdown} from '../../utils/markdownUtils';
import {getStoredToolActivityDetail, getToolActivityDisplayLabel} from '../../utils/toolActivity';

interface ResponseProcessProps {
    activities?: ToolActivity[];
    progressMessages?: ResponseProgressMessage[];
    isStreaming?: boolean;
    hasResponseContent?: boolean;
    requestElapsedLabel?: string;
}

type ProcessItem =
    | {kind: 'message'; timestamp: number; value: ResponseProgressMessage}
    | {kind: 'tool'; timestamp: number; value: ToolActivity};

export default function ResponseProcess({
    activities = [],
    progressMessages = [],
    isStreaming = false,
    hasResponseContent = false,
    requestElapsedLabel,
}: ResponseProcessProps) {
    const {t} = useTranslation('main');
    const [expanded, setExpanded] = useState(isStreaming && !hasResponseContent);
    const items: ProcessItem[] = [
        ...progressMessages.map(value => ({kind: 'message' as const, timestamp: value.createdAt, value})),
        ...activities
            .filter(value => value.group === 'code' || value.group === 'tool')
            .map(value => ({kind: 'tool' as const, timestamp: value.startedAt ?? 0, value})),
    ].sort((left, right) => left.timestamp - right.timestamp);

    useEffect(() => {
        setExpanded(isStreaming && !hasResponseContent);
    }, [hasResponseContent, isStreaming]);

    if (!items.length) return null;

    const statusLabel = requestElapsedLabel
        ? t(isStreaming ? 'toolActivity.workingFor' : 'toolActivity.workedFor', {duration: requestElapsedLabel})
        : t(isStreaming ? 'toolActivity.working' : 'toolActivity.completed');

    return <section className={`msg-response-process${expanded ? ' expanded' : ''}`} aria-label={t('toolActivity.ariaLabel')}>
        <button
            type="button"
            className="msg-process-toggle"
            aria-expanded={expanded}
            aria-label={t(expanded ? 'toolActivity.collapseProcess' : 'toolActivity.expandProcess')}
            onClick={() => setExpanded(current => !current)}
        >
            <span className={`msg-process-status-icon${isStreaming ? ' streaming' : ''}`} aria-hidden="true">
                <Sparkles size={15}/>
            </span>
            <span className="msg-process-status-label">{statusLabel}</span>
            <ChevronDown className="msg-process-chevron" size={15} aria-hidden="true"/>
        </button>
        {expanded && <div className="msg-process-details">
            {items.map((item, index) => item.kind === 'message' ? (
                <div
                    key={item.value.id ?? `message-${item.timestamp}-${index}`}
                    className="msg-process-message"
                    dangerouslySetInnerHTML={{__html: linkify(renderMarkdown(item.value.content))}}
                />
            ) : (() => {
                const activity = item.value;
                const detail = getStoredToolActivityDetail(activity.detail);
                const outcomeClass = activity.outcome ? ` ${activity.outcome}` : '';
                const icon = activity.outcome === 'failed'
                    ? <CircleX size={15} aria-hidden="true"/>
                    : activity.outcome === 'rejected'
                        ? <Ban size={15} aria-hidden="true"/>
                        : activity.phase === 'completed'
                            ? <CircleCheck size={15} aria-hidden="true"/>
                            : <BookOpen size={15} aria-hidden="true"/>;
                return <div key={activity.id ?? `tool-${item.timestamp}-${index}`} className={`msg-process-tool ${activity.phase}${outcomeClass}`}>
                    <div className="msg-process-tool-header">
                        {icon}
                        <span>{getToolActivityDisplayLabel(activity.name, activity.label, t, activity.phase, activity.outcome)}</span>
                    </div>
                    {detail && <code>{detail}</code>}
                </div>
            })())}
        </div>}
    </section>;
}
