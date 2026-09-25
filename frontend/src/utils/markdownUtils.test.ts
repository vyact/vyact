import {describe, expect, it} from 'vitest';
import {renderMarkdown} from './markdownUtils';

describe('renderMarkdown lists', () => {
    it('keeps indented bullets inside their numbered parent and continues numbering', () => {
        const html = renderMarkdown('1. First\n   - Child A\n   - Child B\n2. Second');

        expect(html).toMatch(/<ol[^>]*><li value="1"[^>]*>First<ul[^>]*><li[^>]*>Child A<\/li><li[^>]*>Child B<\/li><\/ul><\/li><li value="2"[^>]*>Second<\/li><\/ol>/);
        expect(html).not.toContain('<br/>');
    });

    it('keeps checklist items and separate prose readable', () => {
        const html = renderMarkdown('- [ ] Pending\n- [x] Done\n\nNext paragraph');

        expect(html).toContain('<input type="checkbox" disabled');
        expect(html).toContain('checked');
        expect(html).toMatch(/<\/ul><div class="para-break"><\/div>Next paragraph/);
    });
});
