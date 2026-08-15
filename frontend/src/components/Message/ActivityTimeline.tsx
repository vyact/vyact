import {useState} from 'react';
import {ChevronDown, ChevronRight, CircleCheck, CircleX} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import type {ToolActivity} from '../../types';
import {getStoredToolActivityDetail, getToolActivityDisplayLabel} from '../../utils/toolActivity';

interface ActivityTimelineProps {
    activities: ToolActivity[];
    executionDurationNs?: number | null;
    isStreaming?: boolean;
    currentStatus?: ToolActivity;
    requestElapsedLabel?: string;
}

const ActivityTimeline = ({
    activities,
    executionDurationNs,
    isStreaming = false,
    currentStatus,
    requestElapsedLabel,
}: ActivityTimelineProps) => {
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
    const summary = isStreaming
        ? t('toolActivity.inProgressSummary', {
            count: taskCount,
            status: currentStatus?.label ?? t('toolActivity.working'),
        })
        : t('toolActivity.completedSummary', {count: taskCount, seconds: elapsedSeconds});
    const formatActivitySeconds = (activity: ToolActivity): string | null => {
        if (activity.startedAt == null || activity.completedAt == null) return null;
        return formatDurationSeconds(Math.max(0, activity.completedAt - activity.startedAt));
    };

    return (
        <section className={`msg-activity ${isStreaming ? 'streaming' : 'completed'}${isExpanded ? ' expanded' : ''}`}>
            <button className="msg-activity-summary"
                    onClick={() => setIsExpanded(value => !value)}>
                {isStreaming ? <span className="msg-activity-spinner"/> : <CircleCheck size={14}/>}
                <span>{summary}</span>
                {isStreaming && requestElapsedLabel && (
                    <span className="msg-request-elapsed">{requestElapsedLabel}</span>
                )}
                {isExpanded ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
            </button>
            {isExpanded && <ol className="msg-activity-list">
                {taskActivities.map((activity, index) => {
                    const activitySeconds = formatActivitySeconds(activity);
                    const displayDetail = getStoredToolActivityDetail(activity.detail);
                    return <li key={activity.id ?? index} className={activity.phase}>
                        {activity.outcome === 'failed'
                            ? <CircleX className="msg-activity-failed" size={12}/>
                            : activity.phase === 'completed'
                            ? <CircleCheck className="msg-activity-check" size={12}/>
                            : <span className="msg-activity-dot"/>}
                        <span className="msg-activity-content">
                            <span className="msg-activity-label">
                                {getToolActivityDisplayLabel(activity.name, activity.label, t, activity.phase, activity.outcome)}
                            </span>
                            {displayDetail && <code>{displayDetail}</code>}
                        </span>
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
