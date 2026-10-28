import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {describe, expect, it, vi} from 'vitest';
import FinalSettingsLibrary from './FinalSettingsLibrary';
vi.mock('react-i18next', () => ({useTranslation: () => ({t: (key: string) => key})}));
describe('final settings library', () => {
    it('starts collapsed and shows the active version without raw Markdown', () => {
        const html = renderToStaticMarkup(createElement(FinalSettingsLibrary, {items: [{id: 'a', title: 'Quiet mystery', content: '# Secret setting'}, {id: 'b', title: 'Thriller', content: '# Other setting'}], activeId: 'b', disabled: false, onSelect: vi.fn(), onView: vi.fn(), onChange: vi.fn()}));
        expect(html).toContain('Thriller');
        expect(html).toContain('aria-expanded="false"');
        expect(html).not.toContain('# Secret setting');
        expect(html).not.toContain('textarea');
    });
});
