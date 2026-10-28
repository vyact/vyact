import {describe, expect, it} from 'vitest';
import {getTitleSources, selectTitleSources} from './titleSuggestions';
import type {Story} from './storyStorage';
describe('title recommendation context', () => {
    it('keeps all chapters and final versions individually selectable and sends full selected text only', () => {
        const story: Story = {id: 'story', title: 'Work', chapters: [{id: 'same', title: 'One', text: 'Full prose'}, {id: 'empty', title: 'Empty', text: ' '}], finalSettings: [{id: 'same', title: 'Setting', content: 'Full setting'}]};
        const sources = getTitleSources(story);
        expect(sources.chapters).toHaveLength(1);
        expect(selectTitleSources([...sources.chapters, ...sources.settings], new Set(['chapter:same']))).toEqual([{id: 'setting:same', title: 'Setting', content: 'Full setting'}]);
        expect(selectTitleSources([...sources.chapters, ...sources.settings], new Set()).map(source => source.content)).toEqual(['Full prose', 'Full setting']);
    });
});
