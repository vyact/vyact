interface TextLogEntry {raw: string; timestamp: string; level: string; source: string; message: string}
const STANDARD_LOG = /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)\s+[-–]\s+(.+?)\s+[-–]\s+(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+[-–]\s?(.*)$/;
const SIMPLE_LOG = /^\[?(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:\d{2})?)\]?\s*(.*)$/;

export function parseTextLogs(content: string): TextLogEntry[] {
    const entries: TextLogEntry[] = [];
    for (const line of content.replace(/\r\n/g, '\n').split('\n')) {
        const standard = line.match(STANDARD_LOG);
        const simple = !standard && line.match(SIMPLE_LOG);
        if (standard) {
            entries.push({raw: line, timestamp: standard[1], source: standard[2], level: standard[3], message: standard[4]});
        } else if (simple) {
            const structured = simple[2].match(/^(DEBUG|INFO|WARNING|WARN|ERROR|CRITICAL)\s+([^:]+):\s?(.*)$/);
            entries.push({raw: line, timestamp: simple[1], source: structured?.[2] || '', level: structured?.[1] || '', message: structured?.[3] ?? simple[2]});
        } else if (entries.length && (/^\s/.test(line) || /^Traceback|^\w+(?:Error|Exception):|^During handling|^The above exception/.test(line) || !line)) {
            entries[entries.length - 1].raw += `\n${line}`;
            entries[entries.length - 1].message += `\n${line}`;
        } else {
            entries.push({raw: line, timestamp: '', source: '', level: '', message: line});
        }
    }
    return entries;
}

