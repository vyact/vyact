import {describe, expect, it} from 'vitest';
import {buildChapterContext, getEarlierChapters} from './chapterContext';
const chapters = [{id: 'one', title: 'One', text: 'Earlier prose'}, {id: 'empty', title: 'Empty', text: '  '}, {id: 'current', title: 'Current', text: 'Current prose'}, {id: 'later', title: 'Later', text: 'Future prose'}];
describe('optional previous chapter context', () => {
    it('only includes nonempty chapters before the current chapter', () => {
        expect(getEarlierChapters(chapters, 'current').map(item => item.id)).toEqual(['one']);
        expect(buildChapterContext(chapters, 'current', true)).toBe('One\nEarlier prose');
    });
    it('sends no previous prose when disabled or when there are no earlier chapters', () => {
        expect(buildChapterContext(chapters, 'current', false)).toBe('');
        expect(buildChapterContext(chapters, 'one', true)).toBe('');
        expect(buildChapterContext(chapters, 'missing', true)).toBe('');
    });
});
