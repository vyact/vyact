import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {expect, it, vi} from 'vitest';
import NovelSaveStatus from './NovelSaveStatus';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));

it('never labels generating or unapplied AI results as saved', () => {
    for (const generating of [true, false]) {
        const html = renderToStaticMarkup(createElement(NovelSaveStatus, {generating, unapplied: true, dirty: false, saveStatus: 'saved'}));
        expect(html).toContain(generating ? 'proposalState.generating' : 'proposalState.unapplied');
        expect(html).not.toContain('saveState.saved');
    }
});

it('returns to manuscript persistence status after the proposal is applied', () => {
    for (const saveStatus of ['saved', 'saving', 'error'] as const) {
        const html = renderToStaticMarkup(createElement(NovelSaveStatus, {generating: false, unapplied: false, dirty: false, saveStatus}));
        expect(html).toContain(`saveState.${saveStatus}`);
    }
});
