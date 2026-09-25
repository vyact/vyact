import {describe, expect, it} from 'vitest';
import {formatCodeInput, parseFencedCodeInput, removeCodeBlockTrigger} from './CodeInputBlock';

describe('code input', () => {
    it('turns a pasted fenced block into editable code and preserves indentation', () => {
        const parsed = parseFencedCodeInput('```json\n{\n  "name": "Vyact"\n}\n```');
        expect(parsed).toEqual({language: 'json', code: '{\n  "name": "Vyact"\n}'});
        expect(parseFencedCodeInput('please inspect this code')).toBeNull();
    });

    it('uses a longer fence when the code contains backticks', () => {
        expect(formatCodeInput({language: 'markdown', code: '  ```js\n  x\n  ```'}))
            .toBe('````markdown\n  ```js\n  x\n  ```\n````');
    });

    it('opens the editor for three backticks on their own line', () => {
        expect(removeCodeBlockTrigger('```')).toBe('');
        expect(removeCodeBlockTrigger('Please review:\n```')).toBe('Please review:');
        expect(removeCodeBlockTrigger('`inline`')).toBeNull();
        expect(removeCodeBlockTrigger('text ```')).toBeNull();
    });
});
