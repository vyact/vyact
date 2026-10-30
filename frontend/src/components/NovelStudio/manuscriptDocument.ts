import type {JSONContent} from '@tiptap/core';

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function manuscriptToDocument(text: string): JSONContent {
    const content: JSONContent[] = [];
    for (const line of text.split('\n')) {
        let position = 0;
        let foundImage = false;
        for (const match of line.matchAll(IMAGE_PATTERN)) {
            if (match.index > position) content.push(paragraph(line.slice(position, match.index)));
            const widthMatch = match[2].match(/\?width=(\d+)$/);
            const attrs: Record<string, string | number> = {src: widthMatch ? match[2].replace(/\?width=\d+$/, '') : match[2], alt: match[1]};
            if (widthMatch) attrs.width = Number(widthMatch[1]);
            content.push({type: 'memoImage', attrs});
            position = match.index! + match[0].length;
            foundImage = true;
        }
        if (!foundImage || position < line.length) content.push(paragraph(line.slice(position)));
    }
    return {type: 'doc', content};
}

function paragraph(text: string): JSONContent {
    return {type: 'paragraph', content: text ? [{type: 'text', text}] : []};
}

export function documentToManuscript(document: JSONContent): string {
    const serialize = (node: JSONContent): string => {
        if (node.type === 'memoImage') {
            const width = Number(node.attrs?.width);
            const suffix = Number.isFinite(width) && width > 0 ? `?width=${Math.round(width)}` : '';
            return `![${String(node.attrs?.alt ?? '').replace(/[\[\]]/g, '')}](${node.attrs?.src ?? ''}${suffix})`;
        }
        if (node.type === 'text') return node.text ?? '';
        if (node.type === 'hardBreak') return '\n';
        return (node.content ?? []).map(serialize).join(node.type === 'doc' ? '\n' : '');
    };
    return serialize(document);
}

export function applyManuscriptImageWidths(html: string): string {
    return html.replace(/(<img\b[^>]*src=")(\/api\/novel-studio\/images\/[a-f0-9]{32}\.(?:png|jpg|gif|webp))\?width=(\d+)(")/g,
        (_match, prefix, src, width, closing) => `${prefix}${src}${closing} width="${Number(width)}"`);
}
