import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import ProposalReader from './ProposalReader';

vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
describe('wide response review', () => {
    it('renders formatted reading content without putting save controls in the reading pane', () => {
        const html = renderToStaticMarkup(createElement(ProposalReader, {text: '# Story direction\n\n**Mystery** for adult readers.', action: 'createDirection', busy: false, onChange: vi.fn(), onBack: vi.fn()}));
        expect(html).toMatch(/<h1[^>]*>Story direction<\/h1>/);
        expect(html).toContain('<strong>Mystery</strong>');
        expect(html).not.toContain('<textarea');
        expect(html).not.toContain('saveCandidate');
    });
    it('shows generation progress in the reading pane before a response arrives', () => {
        const html = renderToStaticMarkup(createElement(ProposalReader, {text: '', action: 'createPlot', busy: true, onChange: vi.fn(), onBack: vi.fn()}));
        expect(html).toContain('role="status"');
        expect(html).toContain('novelStudio.generatingResponse');
    });
});
