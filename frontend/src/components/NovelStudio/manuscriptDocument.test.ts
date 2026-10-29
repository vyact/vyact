import {describe, expect, it} from 'vitest';
import {documentToManuscript, manuscriptToDocument} from './manuscriptDocument';

describe('manuscript visual document', () => {
    it('preserves paragraphs, empty lines, and literal Markdown', () => {
        const text = '# 제목\n\n첫 문장 **강조**\n둘째 문장\n\n';
        expect(documentToManuscript(manuscriptToDocument(text))).toBe(text);
    });
    it('displays image syntax as an image node and preserves its path on save', () => {
        const text = '앞 문단\n\n![장면](/api/novel-studio/images/abc.png)\n\n뒤 문단';
        const document = manuscriptToDocument(text);
        expect(document.content?.find(node => node.type === 'memoImage')?.attrs).toEqual({src: '/api/novel-studio/images/abc.png', alt: '장면'});
        expect(documentToManuscript(document)).toBe(text);
    });
    it('serializes image deletion without leaving its Markdown tag', () => {
        const document = manuscriptToDocument('앞\n![](/api/novel-studio/images/abc.png)\n뒤');
        document.content = document.content?.filter(node => node.type !== 'memoImage');
        expect(documentToManuscript(document)).toBe('앞\n뒤');
    });
});
