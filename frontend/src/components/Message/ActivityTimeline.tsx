import {useState} from 'react';
import {ChevronDown, ChevronRight, CircleCheck, LoaderCircle} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ToolActivity} from '../../types';

interface ActivityTimelineProps {
    activities: ToolActivity[];
    isStreaming: boolean;
}

const ActivityTimeline = ({activities, isStreaming}: ActivityTimelineProps) => {
    const {t} = useTranslation('main');
    const [isExpanded, setIsExpanded] = useState(true);
    if (!isStreaming || !activities.length) return null;
    const latest = activities[activities.length - 1];
    const elapsedSeconds = Math.max(1, Math.round(((latest.completedAt ?? Date.now()) - (activities[0].startedAt ?? Date.now())) / 1000));
    const hasCodeActivity = activities.some(activity => activity.group === 'code');
    const hasDetails = activities.length > 1;
    const taskCount = Math.max(1, activities.filter(activity => activity.group === 'code' || activity.group === 'tool').length);
    const summary = isStreaming
        ? hasCodeActivity ? t('toolActivity.codeAnalysis') : latest.label
        : t('toolActivity.completedSummary', {count: taskCount, seconds: elapsedSeconds});

    return (
        <section className={`msg-activity${isExpanded ? ' expanded' : ''}`} aria-live="polite">
            <button className={`msg-activity-summary${hasDetails ? '' : ' no-details'}`}
                    onClick={() => hasDetails && setIsExpanded(value => !value)}>
                {isStreaming ? <LoaderCircle size={14} className="msg-activity-spinner"/> : <CircleCheck size={14}/>}
                <span>{summary}</span>
                {hasDetails && (isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>)}
            </button>
            {isExpanded && hasDetails && <ol className="msg-activity-list">
                {activities.map((activity, index) => <li key={activity.id ?? index} className={activity.phase}>
                    {activity.phase === 'completed'
                        ? <CircleCheck className="msg-activity-check" size={12}/>
                        : <span className="msg-activity-dot"/>}
                    <span>{activity.label}</span>
                    {activity.detail && <code>{activity.detail}</code>}
                </li>)}
            </ol>}
        </section>
    );
};

export default ActivityTimeline;
