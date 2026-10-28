import {describe, expect, it} from 'vitest';
import {reviseSavedProposal} from './savedProposal';
import type {Story} from './storyStorage';
const story: Story = {id: 'story', title: 'Story', chapters: [], activeFinalSettingId: 'final', settingsCandidates: [{id: 'candidate', category: 'createPlot', title: 'Plot', content: 'Original', selected: true}], finalSettings: [{id: 'final', title: 'Final', content: 'Original final'}]};
const revision = {title: 'Revised', content: 'New content', instruction: 'Change ending', authorDirection: 'Change ending'};
describe('saving revisions to existing entries', () => {
    it('updates the original candidate while preserving selection and category', () => {
        const result = {...story, ...reviseSavedProposal(story, {kind: 'candidate', id: 'candidate'}, revision)};
        expect(result.settingsCandidates).toHaveLength(1);
        expect(result.settingsCandidates?.[0]).toMatchObject({id: 'candidate', category: 'createPlot', selected: true, title: 'Revised', content: 'New content', authorDirection: 'Change ending'});
        expect(story.settingsCandidates?.[0].content).toBe('Original');
    });
    it('updates the final version without changing its active selection or adding a duplicate', () => {
        const result = {...story, ...reviseSavedProposal(story, {kind: 'final', id: 'final'}, {...revision, title: ''})};
        expect(result.finalSettings).toEqual([{id: 'final', title: 'Final', content: 'New content'}]);
        expect(result.activeFinalSettingId).toBe('final');
    });
});
