import {describe, expect, it} from 'vitest';
import {groupContentParts, parseContent, renderMarkdown} from './markdownUtils';

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

    it('keeps numbered steps in one list across blank lines and nested bullets', () => {
        const html = renderMarkdown('1. First step\n2. A longer second step\n   - Detail A\n   - Detail B\n\n3. Third step\n\n4. Fourth step\n\nAfter the steps');

        expect(html.match(/<ol class="markdown-list"/g)).toHaveLength(1);
        expect(html).toMatch(/<li value="2"[^>]*>A longer second step<ul[^>]*>.*Detail A.*Detail B.*<\/ul><\/li><li value="3"/s);
        expect(html).toMatch(/<li value="3"[^>]*>Third step<\/li><li value="4"/);
        expect(html).toMatch(/<\/ol><div class="para-break"><\/div>After the steps/);
    });

    it('places checklist children below the parent task text', () => {
        const html = renderMarkdown('- [ ] Parent task\n  - Child detail\n- [x] Done task');

        expect(html).toMatch(/<li class="markdown-task-item"><span class="markdown-task-line">.*Parent task<\/span><\/span><ul[^>]*><li[^>]*>Child detail<\/li><\/ul><\/li>/s);
        expect(html).toContain('markdown-task-label--done');
    });

    it('keeps an indented child attached after a blank line', () => {
        const html = renderMarkdown('1. Parent\n\n  - Child\n2. Next');

        expect(html).toMatch(/<li value="1"[^>]*>Parent<ul[^>]*><li[^>]*>Child<\/li><\/ul><\/li><li value="2"/);
    });

    it('preserves distinct block and inline formats around lists', () => {
        const html = renderMarkdown('# Heading\n\nIntro with **bold**, `code`, [link](https://example.org/a_b), and $E=mc^2$.\n\n> First quote\n> Second quote\n\n---\n\n- [ ] Task\n- Item with *emphasis*\n\n$$a^2+b^2=c^2$$');

        expect(html).toContain('<h1');
        expect(html).toContain('<strong>bold</strong>');
        expect(html).toContain('<code');
        expect(html).toContain('href="https://example.org/a_b"');
        expect(html).toContain('katex');
        expect(html).toMatch(/<blockquote[^>]*>First quote<br\/>Second quote<\/blockquote>/);
        expect(html).toContain('<hr');
        expect(html).toContain('<input type="checkbox" disabled');
        expect(html).toContain('<em>emphasis</em>');
    });

    it('uses a bounded preview class for an image and keeps a long link intact', () => {
        const html = renderMarkdown('![Vyact icon](/vyact-icon.png)\n\n[문서_경로_설정_화면_사용_방법](https://example.org/docs/a_very_long_path_name_for_wrap_check)');

        expect(html).toContain('<img class="markdown-image" src="/vyact-icon.png" alt="Vyact icon" />');
        expect(html).not.toContain('alt="Vyact icon" /><br/>');
        expect(html).toContain('href="https://example.org/docs/a_very_long_path_name_for_wrap_check"');
        expect(html).toContain('>문서_경로_설정_화면_사용_방법</a>');
    });
});

describe('code file labels', () => {
    it('shows a project tree as text even when the model calls its fence Java', () => {
        const response = [
            'Project structure:',
            '```java',
            'pom.xml',
            'src/',
            '└── main/',
            '    ├── java/',
            '    └── resources/',
            '```',
        ].join('\n');
        const groups = groupContentParts(parseContent(response));

        expect(groups[1]).toMatchObject({
            type: 'codefiles',
            files: [{name: 'project-structure.txt', lang: 'text'}],
        });
    });

    it('uses a nearby properties filename and preserves Java class names', () => {
        const response = [
            'DemoApplication.java',
            '```java',
            'public class DemoApplication {}',
            '```',
            'application.properties',
            '```properties',
            'server.port=8080',
            '```',
        ].join('\n');
        const files = groupContentParts(parseContent(response))
            .filter(group => group.type === 'codefiles')
            .flatMap(group => group.files ?? []);

        expect(files.map(file => file.name)).toEqual(['DemoApplication.java', 'application.properties']);
    });

    it('removes shared fence indentation without changing relative code indentation', () => {
        const response = [
            'application.properties',
            '```properties',
            '   spring.application.name=DemoApplication',
            '   server.port=8080',
            '```',
            'DemoApplication.java',
            '```java',
            '   class DemoApplication {',
            '       void run() {}',
            '   }',
            '```',
        ].join('\n');
        const files = groupContentParts(parseContent(response))
            .filter(group => group.type === 'codefiles')
            .flatMap(group => group.files ?? []);

        expect(files[0].code.trimEnd()).toBe('spring.application.name=DemoApplication\nserver.port=8080');
        expect(files[1].code.trimEnd()).toBe('class DemoApplication {\n    void run() {}\n}');
    });
});
