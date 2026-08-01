import {useState} from 'react';
import {ChevronDown, ChevronRight, CircleCheck} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ToolActivity} from '../../types';
import {getToolActivityLabel} from '../../utils/toolActivity';

interface ActivityTimelineProps {
    activities: ToolActivity[];
    executionDurationNs?: number | null;
}

const ActivityTimeline = ({activities, executionDurationNs}: ActivityTimelineProps) => {
    const {t} = useTranslation('main');
    const [isExpanded, setIsExpanded] = useState(false);
    const taskActivities = activities.filter(activity => activity.group === 'code' || activity.group === 'tool');
    if (!taskActivities.length) return null;
    const measuredDurationMs = taskActivities.reduce((total, activity) => (
        total + Math.max(0, (activity.completedAt ?? Date.now()) - (activity.startedAt ?? Date.now()))
    ), 0);
    const executionDurationMs = executionDurationNs && executionDurationNs > 0
        ? executionDurationNs / 1_000_000
        : measuredDurationMs;
    const formatDurationSeconds = (durationMs: number): string => {
        if (durationMs < 100) return '<0.1';
        const durationSeconds = durationMs / 1000;
        return durationSeconds < 10 ? durationSeconds.toFixed(1) : String(Math.round(durationSeconds));
    };
    const elapsedSeconds = formatDurationSeconds(executionDurationMs);
    const taskCount = taskActivities.length;
    const summary = t('toolActivity.completedSummary', {count: taskCount, seconds: elapsedSeconds});
    const formatActivitySeconds = (activity: ToolActivity): string | null => {
        if (activity.startedAt == null || activity.completedAt == null) return null;
        return formatDurationSeconds(Math.max(0, activity.completedAt - activity.startedAt));
    };

    return (
        <section className={`msg-activity completed${isExpanded ? ' expanded' : ''}`}>
            <button className="msg-activity-summary"
                    onClick={() => setIsExpanded(value => !value)}>
                <CircleCheck size={14}/>
                <span>{summary}</span>
                {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </button>
            {isExpanded && <ol className="msg-activity-list">
                {taskActivities.map((activity, index) => {
                    const activitySeconds = formatActivitySeconds(activity);
                    return <li key={activity.id ?? index} className={activity.phase}>
                        {activity.phase === 'completed'
                            ? <CircleCheck className="msg-activity-check" size={12}/>
                            : <span className="msg-activity-dot"/>}
                        <span>{activity.name ? getToolActivityLabel(activity.name, t) : activity.label}</span>
                        {activity.detail && <code>{activity.detail}</code>}
                        {activitySeconds != null && (
                            <span className="msg-activity-duration">
                                {t('toolActivity.elapsed', {seconds: activitySeconds})}
                            </span>
                        )}
                    </li>;
                })}
            </ol>}
        </section>
    );
};

export default ActivityTimeline;
