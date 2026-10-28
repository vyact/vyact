import {describe, expect, it} from 'vitest';
import {getSettingsContext} from './settingsContext';
import {SETTING_CATEGORIES, type SettingCandidate} from './storyStorage';

const candidates: SettingCandidate[] = SETTING_CATEGORIES.map(category => ({id: category, category, title: category, content: category, selected: true}));
describe('settings proposal context', () => {
    it.each(SETTING_CATEGORIES)('includes only earlier categories for %s', category => {
        const index = SETTING_CATEGORIES.indexOf(category);
        expect(getSettingsContext(candidates, category).map(item => item.category)).toEqual(SETTING_CATEGORIES.slice(0, index));
    });
    it('excludes disabled categories without changing saved selections', () => {
        expect(getSettingsContext(candidates, 'createCharacters', ['createDirection']).map(item => item.category)).toEqual(['createPremise']);
        expect(getSettingsContext(candidates, 'synthesis', [...SETTING_CATEGORIES])).toEqual([]);
        expect(candidates.every(item => item.selected)).toBe(true);
    });
    it('excludes unchecked candidates and keeps all selections for synthesis', () => {
        const items = candidates.map((candidate, index) => ({...candidate, selected: index !== 0}));
        expect(getSettingsContext(items, 'createCharacters').map(item => item.category)).toEqual(['createPremise']);
        expect(getSettingsContext(items, 'synthesis')).toEqual(items.slice(1));
    });
});
