import {BookOpen, CircleCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ResponseProgressMessage, ToolActivity} from '../../types';
import {linkify, renderMarkdown} from '../../utils/markdownUtils';
import {getStoredToolActivityDetail, getToolActivityDisplayLabel} from '../../utils/toolActivity';

interface ResponseProcessProps {
    activities?: ToolActivity[];
    progressMessages?: ResponseProgressMessage[];
    isStreaming?: boolean;
    requestElapsedLabel?: string;
}

type ProcessItem =
    | {kind: 'message'; timestamp: number; value: ResponseProgressMessage}
    | {kind: 'tool'; timestamp: number; value: ToolActivity};

export default function ResponseProcess({activities = [], progressMessages = [], isStreaming = false, requestElapsedLabel}: ResponseProcessProps) {
    const {t} = useTranslation('main');
    const items: ProcessItem[] = [
        ...progressMessages.map(value => ({kind: 'message' as const, timestamp: value.createdAt, value})),
        ...activities
            .filter(value => value.group === 'code' || value.group === 'tool')
            .map(value => ({kind: 'tool' as const, timestamp: value.startedAt ?? 0, value})),
    ].sort((left, right) => left.timestamp - right.timestamp);

    if (!items.length) return null;

    return <section className="msg-response-process" aria-label={t('toolActivity.ariaLabel')}>
        {isStreaming && requestElapsedLabel && (
            <div className="msg-process-elapsed">{t('toolActivity.workingFor', {duration: requestElapsedLabel})}</div>
        )}
        {items.map((item, index) => item.kind === 'message' ? (
            <div
                key={item.value.id ?? `message-${item.timestamp}-${index}`}
                className="msg-process-message"
                dangerouslySetInnerHTML={{__html: linkify(renderMarkdown(item.value.content))}}
            />
        ) : (() => {
            const activity = item.value;
            const detail = getStoredToolActivityDetail(activity.detail);
            return <div key={activity.id ?? `tool-${item.timestamp}-${index}`} className={`msg-process-tool ${activity.phase}`}>
                {activity.phase === 'completed'
                    ? <CircleCheck size={15} aria-hidden="true"/>
                    : <BookOpen size={15} aria-hidden="true"/>}
                <span>{getToolActivityDisplayLabel(activity.name, activity.label, t, activity.phase, activity.outcome)}</span>
                {detail && <code>{detail}</code>}
            </div>;
        })())}
    </section>;
}
