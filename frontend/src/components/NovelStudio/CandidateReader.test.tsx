import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import CandidateReader from './CandidateReader';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
describe('saved candidate reading', () => {
    it('opens formatted content with return/edit controls and the original query', () => {
        const html = renderToStaticMarkup(createElement(CandidateReader, {candidate: {id: 'candidate', category: 'createDirection', title: 'Quiet mystery', content: '# A quiet mystery\n\n**Adult readers**', selected: true, generationInstruction: 'Develop direction.\n\nA quiet mystery.', authorDirection: 'A quiet mystery.'}, onChange: vi.fn(), onBack: vi.fn()}));
        expect(html).toContain('novelStudio.backToList');
        expect(html).toContain('novelStudio.createDirection');
        expect(html).not.toContain('novelStudio.savedCandidate');
        expect(html).toContain('novelStudio.editResponse');
        expect(html).toContain('novelStudio.generationQuery');
        expect(html).toContain('Develop direction.');
        expect(html).toContain('<strong>Adult readers</strong>');
        expect(html).not.toContain('saveCandidate');
    });
});
