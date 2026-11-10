import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import CandidateReader from './CandidateReader';
import ProposalReader from './ProposalReader';
import CandidateQuery from './CandidateQuery';

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

describe('wide response review', () => {
    it('renders formatted reading content without putting save controls in the reading pane', () => {
        const html = renderToStaticMarkup(createElement(ProposalReader, {text: '# Story direction\n\n**Mystery** for adult readers.', action: 'createDirection', busy: false, onChange: vi.fn()}));
        expect(html).toMatch(/<h1[^>]*>Story direction<\/h1>/);
        expect(html).toContain('<strong>Mystery</strong>');
        expect(html).not.toContain('<textarea');
        expect(html).not.toContain('saveCandidate');
        expect(html).not.toContain('backToWorkspace');
        expect(html).toContain('novel-response-title');
    });
    it('shows generation progress in the reading pane before a response arrives', () => {
        const html = renderToStaticMarkup(createElement(ProposalReader, {text: '', action: 'createPlot', busy: true, onChange: vi.fn()}));
        expect(html).toContain('role="status"');
        expect(html).toContain('novelStudio.generatingResponse');
    });
});

describe('candidate question visibility', () => {
    it('explains missing historical query data rather than hiding the question section', () => {
        const html = renderToStaticMarkup(createElement(CandidateQuery, {candidate: {id: 'old', category: 'createDirection', title: 'Old', content: 'Existing response', selected: true}}));
        expect(html).toContain('novelStudio.generationQuery');
        expect(html).toContain('novelStudio.missingGenerationQuery');
    });
});


describe('full generation request disclosure', () => {
    it.each([
        ['Same question', 'Same question', false],
        ['  Same question\nNext line  ', 'Same question\r\nNext line', false],
        ['My question', 'Additional guidance\n\nMy question', true],
    ])('shows full request only when it adds information', (authorDirection, generationInstruction, expected) => {
        const html = renderToStaticMarkup(createElement(CandidateQuery, {candidate: {id: 'candidate', category: 'createDirection', title: 'Title', content: 'Response', selected: true, authorDirection, generationInstruction}}));
        expect(html.includes('novelStudio.fullGenerationQuery')).toBe(expected);
    });
});
