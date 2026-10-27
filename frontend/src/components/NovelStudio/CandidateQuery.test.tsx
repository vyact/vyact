import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import CandidateQuery from './CandidateQuery';
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
describe('candidate question visibility', () => {
    it('explains missing historical query data rather than hiding the question section', () => {
        const html = renderToStaticMarkup(createElement(CandidateQuery, {candidate: {id: 'old', category: 'createDirection', title: 'Old', content: 'Existing response', selected: true}}));
        expect(html).toContain('novelStudio.generationQuery');
        expect(html).toContain('novelStudio.missingGenerationQuery');
    });
});
