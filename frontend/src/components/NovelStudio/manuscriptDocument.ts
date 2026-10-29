import type {JSONContent} from '@tiptap/core';

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function manuscriptToDocument(text: string): JSONContent {
    const content: JSONContent[] = [];
    for (const line of text.split('\n')) {
        let position = 0;
        let foundImage = false;
        for (const match of line.matchAll(IMAGE_PATTERN)) {
            if (match.index > position) content.push(paragraph(line.slice(position, match.index)));
            content.push({type: 'memoImage', attrs: {src: match[2], alt: match[1]}});
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
        if (node.type === 'memoImage') return `![${String(node.attrs?.alt ?? '').replace(/[\[\]]/g, '')}](${node.attrs?.src ?? ''})`;
        if (node.type === 'text') return node.text ?? '';
        if (node.type === 'hardBreak') return '\n';
        return (node.content ?? []).map(serialize).join(node.type === 'doc' ? '\n' : '');
    };
    return serialize(document);
}
