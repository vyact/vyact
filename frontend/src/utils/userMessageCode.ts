export type UserMessagePart = {type: 'text' | 'code'; value: string; language?: string};

export function splitUserMessageCode(content: string): UserMessagePart[] {
    const parts: UserMessagePart[] = [];
    const fencePattern = /(^|\n)(`{3,}|~{3,})([\w+#.-]*)\r?\n([\s\S]*?)\r?\n\2(?=\n|$)/g;
    let cursor = 0;
    for (const match of content.matchAll(fencePattern)) {
        const start = match.index;
        if (start > cursor) parts.push({type: 'text', value: content.slice(cursor, start)});
        parts.push({type: 'code', value: match[4], language: match[3]});
        cursor = start + match[0].length;
    }
    if (cursor < content.length || parts.length === 0) parts.push({type: 'text', value: content.slice(cursor)});
    return parts;
}
