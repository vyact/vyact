import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import ManuscriptActions from './ManuscriptActions';
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
describe('manuscript action explanations', () => {
    it('explains each action even when review is unavailable for an empty draft', () => {
        const html = renderToStaticMarkup(createElement(ManuscriptActions, {hasText: false, active: 'start', busy: false, onChoose: vi.fn()}));
        expect(html).toContain('manuscriptActionHelp.start');
        expect(html).toContain('manuscriptActionHelp.outline');
        expect(html).toContain('manuscriptActionHelp.review');
        expect(html).toMatch(/disabled=""[^>]*>novelStudio.manuscriptActions.review/);
    });
    it('offers continuation for an existing draft', () => {
        const html = renderToStaticMarkup(createElement(ManuscriptActions, {hasText: true, active: 'continue', busy: false, onChoose: vi.fn()}));
        expect(html).toContain('manuscriptActions.continue');
        expect(html).not.toContain('manuscriptActions.start');
    });
});
