import i18n from 'i18next';
import {useTranslation} from 'react-i18next';
import LogCopyButton from './LogCopyButton';
import {useMemo} from 'react';
import {ChevronRight} from 'lucide-react';
import './RequestLogEntries.css';

const MAX_TREE_DEPTH = 2;
const SUMMARY_LENGTH = 240;

function valueText(value: unknown): string {
    return typeof value === 'string' ? value : JSON.stringify(value);
}

function timestampText(value: unknown): string {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) return valueText(value);
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString(i18n.resolvedLanguage || i18n.language || 'en');
}

export function parseRequestLogs(content: string) {
    const occurrences = new Map<string, number>();
    return content.split('\n').filter(line => line.trim()).map(line => {
        let value: unknown = line;
        try {value = JSON.parse(line);} catch { /* Preserve partial or malformed records as text. */ }
        const record = value !== null && typeof value === 'object' && !Array.isArray(value)
            ? value as Record<string, unknown> : null;
        const identity = record ? `${record.request_id ?? ''}:${record.timestamp ?? ''}` : line;
        const occurrence = occurrences.get(identity) ?? 0;
        occurrences.set(identity, occurrence + 1);
        const summary = record
            ? [record.timestamp == null ? null : timestampText(record.timestamp), record.model, record.user_prompt || record.error || record.response || record.request_id]
                .filter(item => item !== undefined && item !== null && item !== '')
                .map(valueText).join(' · ')
            : line;
        const compact = (summary || line).replace(/\s+/g, ' ');
        return {key: `${identity}:${occurrence}`, raw: line, value, summary: compact.length > SUMMARY_LENGTH ? `${compact.slice(0, SUMMARY_LENGTH)}...` : compact};
    });
}

function JsonFields({value, depth = 1}: {value: unknown; depth?: number}) {
    if (value === null || typeof value !== 'object') return <span className="request-log-value">{valueText(value)}</span>;
    return <div className="request-log-fields">
        {Object.entries(value).map(([key, child]) => <div className="request-log-field" key={key}>
            <span className="request-log-key">{key}</span>
            {depth < MAX_TREE_DEPTH && child !== null && typeof child === 'object'
                ? <JsonFields value={child} depth={depth + 1}/>
                : <span className="request-log-value">{
                    key === 'timestamp' ? timestampText(child)
                        : key === 'model_requests' && Array.isArray(child) ? JSON.stringify(child, null, 2)
                            : valueText(child)
                }</span>}
        </div>)}
    </div>;
}

export default function RequestLogEntries({content, onInspect}: {content: string; onInspect: () => void}) {
    const {i18n: currentI18n} = useTranslation();
    const language = currentI18n.resolvedLanguage || currentI18n.language;
    const entries = useMemo(() => parseRequestLogs(content), [content, language]);
    return <div className="request-log-entries">
        {entries.map(entry => <details className="request-log-entry" key={entry.key}>
            <summary onClick={onInspect}>
                <ChevronRight size={14} aria-hidden="true"/>
                <span>{entry.summary}</span>
                <LogCopyButton text={entry.raw}/>
            </summary>
            <div className="request-log-body"><JsonFields value={entry.value}/></div>
        </details>)}
    </div>;
}
