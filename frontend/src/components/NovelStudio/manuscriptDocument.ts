import type {JSONContent} from '@tiptap/core';
import {renderMarkdown} from '../../utils/markdownUtils';

const IMAGE_PATTERN = /!\[([^\]]*)\]\(([^)\s]+)\)/g;

export function countManuscriptCharacters(text: string): number {
    const textWithoutImages = text.replace(IMAGE_PATTERN, '');
    if (!textWithoutImages) return 0;
    const renderedText = renderMarkdown(textWithoutImages)
        .replace(/<br\s*\/?\s*>/gi, '\n')
        .replace(/<div class="para-break"><\/div>/g, '\n')
        .replace(/<[^>]*>/g, '')
        .replace(/&(amp|lt|gt|quot|apos|nbsp|#\d+|#x[\da-f]+);/gi, (entity, value: string) => {
            const namedEntities: Record<string, string> = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: '\u00a0'};
            if (!value.startsWith('#')) return namedEntities[value.toLowerCase()] ?? entity;
            const codePoint = value[1].toLowerCase() === 'x' ? parseInt(value.slice(2), 16) : Number(value.slice(1));
            return codePoint >= 0 && codePoint <= 0x10ffff ? String.fromCodePoint(codePoint) : entity;
        });
    return Array.from(renderedText).length;
}

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
