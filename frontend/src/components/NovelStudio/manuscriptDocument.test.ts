import {describe, expect, it} from 'vitest';
import {countManuscriptCharacters, documentToManuscript, manuscriptToDocument} from './manuscriptDocument';

it('excludes image paths, alt text, and resize metadata from character counts', () => {
    const image = '![장면 설명](/api/novel-studio/images/abc.png?width=320)';
    expect(countManuscriptCharacters(image)).toBe(0);
    expect(countManuscriptCharacters(`앞😀${image}뒤`)).toBe(3);
    expect(countManuscriptCharacters(`${image}${image}`)).toBe(0);
    expect(countManuscriptCharacters('문장\n 공백')).toBe(6);
});

it('counts rendered Markdown text without formatting delimiters or link URLs', () => {
    expect(countManuscriptCharacters('`코드`')).toBe(2);
    expect(countManuscriptCharacters('**강조** *기울임* ~~취소~~')).toBe(9);
    expect(countManuscriptCharacters('[링크](https://example.com)')).toBe(2);
    expect(countManuscriptCharacters('# 제목')).toBe(2);
    expect(countManuscriptCharacters('`a < b && c`')).toBe(10);
    expect(countManuscriptCharacters('미완성 `')).toBe(5);
});

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

it('preserves resized image width when reopening the manuscript', () => {
    const document = manuscriptToDocument('![](/api/novel-studio/images/abc.png)');
    document.content![0].attrs!.width = 320;
    const stored = documentToManuscript(document);
    expect(stored).toContain('?width=320');
    expect(manuscriptToDocument(stored).content![0].attrs!.width).toBe(320);
});
