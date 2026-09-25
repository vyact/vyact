const codeFence = /^\s*(?:`{3,}|~{3,})([\w+#.-]*)\s*/s;
const filename = /\b([\w.-]+\.(?:py|json|ya?ml|tsx?|jsx?|css|scss|html?|java|go|rs|sh|sql|properties|md|txt))\b/i;

export function readableConversationTitle(title: string): string {
    const trimmed = title.trim();
    const match = trimmed.match(codeFence);
    if (!match) return trimmed;
    const body = trimmed.slice(match[0].length);
    const file = body.slice(0, 300).match(filename);
    if (file) return file[1];
    if (match[1].toLowerCase() === 'json' && body.includes('manifest_ver')) return 'manifest.json';
    const firstLine = body.split(/\r?\n/, 1)[0]
        .replace(/[`~]{3,}.*$/, '').replace(/^[`~'"\s]+|[`~'"\s]+$/g, '').replace(/\s+/g, ' ');
    if (firstLine && !/^[{[<]/.test(firstLine)) return firstLine.slice(0, 36) + (firstLine.length > 36 ? '...' : '');
    return match[1].toUpperCase() || 'Code';
}
