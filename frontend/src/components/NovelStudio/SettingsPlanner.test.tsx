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
        const html = renderToStaticMarkup(createElement(SettingsPlanner, {candidates, disabled: false, onChange: vi.fn(), onChoose: vi.fn(), onSynthesize: vi.fn(), activeCategory: 'createCharacters', children: 'Final settings editor'}));
        expect(html).toContain('The librarian');
        expect(html).not.toContain('Moon library');
        expect(html).toContain('novelStudio.createWorld');
        expect(html).toContain('novelStudio.createDirection');
        expect(html).toContain('novelStudio.createPremise');
        expect(html).toContain('novelStudio.createPlot');
        expect(html).toContain('novelStudio.selectedCandidates:1');
        expect(html).toContain('Final settings editor');
    });
    it('disables synthesis until a saved candidate is selected', () => {
        const html = renderToStaticMarkup(createElement(SettingsPlanner, {candidates: [], disabled: false, onChange: vi.fn(), onChoose: vi.fn(), onSynthesize: vi.fn(), children: null}));
        expect(html).toContain('novelStudio.selectedCandidates:0');
        expect(html).toMatch(/disabled=""[^>]*>[\s\S]*?novelStudio.synthesize/);
    });
});
