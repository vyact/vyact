import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import SettingsPlanner from './SettingsPlanner';
import type {SettingCandidate} from './storyStorage';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string, options?: {count?: number}) => options?.count !== undefined ? `${key}:${options.count}` : key})}));

describe('settings planning stages', () => {
    it('keeps candidates grouped while only checked candidates count toward synthesis', () => {
        const candidates: SettingCandidate[] = [
            {id: 'one', category: 'createCharacters', title: 'The librarian', content: 'Character notes', selected: true},
            {id: 'two', category: 'createWorld', title: 'Moon library', content: 'World notes', selected: false},
        ];
        const html = renderToStaticMarkup(createElement(SettingsPlanner, {candidates, disabled: false, onChange: vi.fn(), onView: vi.fn(), onChoose: vi.fn(), onSynthesize: vi.fn(), children: 'Final settings editor'}));
        expect(html).toContain('The librarian');
        expect(html).not.toContain('Moon library');
        expect(html).not.toContain('novel-category-candidates');
        expect(html).toContain('novel-group-selection');
        expect(html).not.toContain('has-selection');
        expect(html).not.toContain('aria-expanded="true"');
        expect(html).not.toContain('novel-group-candidates');
        expect(html.indexOf('novel-synthesis-bar')).toBeGreaterThan(html.indexOf('novel-candidate-groups'));
        expect(html).toContain('common-checkbox');
        expect(html).toContain('novelStudio.createWorld');
        expect(html).toContain('novelStudio.createDirection');
        expect(html).toContain('novelStudio.createPremise');
        expect(html).toContain('novelStudio.createPlot');
        expect(html).toContain('novelStudio.selectedCandidates:1');
        expect(html).toContain('novelStudio.deselectCandidate');
        expect(html).toContain('novel-candidate-deselect');
        expect(html).toContain('Final settings editor');
    });
    it('hides the synthesis area until a saved candidate is selected', () => {
        const html = renderToStaticMarkup(createElement(SettingsPlanner, {candidates: [], disabled: false, onChange: vi.fn(), onView: vi.fn(), onChoose: vi.fn(), onSynthesize: vi.fn(), children: null}));
        expect(html).not.toContain('novel-synthesis-bar');
        expect(html).not.toContain('novelStudio.synthesize');
    });
});
