import LogCopyButton from './LogCopyButton';
import {useMemo} from 'react';
import './TextLogEntries.css';

import {parseTextLogs} from '../../services/textLogParser';
export {parseTextLogs} from '../../services/textLogParser';

export default function TextLogEntries({content}: {content: string}) {
    const entries = useMemo(() => parseTextLogs(content), [content]);
    return <div className="text-log-entries">
        {entries.map((entry, index) => <div className={`text-log-row text-log-row--${entry.level.toLowerCase()}`} key={index}>
            <div className="text-log-meta">
                <time>{entry.timestamp.slice(11).replace(',', '.')}</time>
                {entry.level && <span className="text-log-level">{entry.level}</span>}
            </div>
            <div className="text-log-main">
                {entry.source && <span className="text-log-source">{entry.source}</span>}
                <div className="text-log-message">{entry.message}</div>
            </div>
            <LogCopyButton text={entry.raw}/>
        </div>)}
    </div>;
}
