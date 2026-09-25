import {describe, expect, it} from 'vitest';
import {splitUserMessageCode} from './userMessageCode';

describe('user message code', () => {
    it('keeps prose around a long fenced code block', () => {
        expect(splitUserMessageCode('Review this:\n```python\nif True:\n    run()\n```\nThanks')).toEqual([
            {type: 'text', value: 'Review this:'},
            {type: 'code', language: 'python', value: 'if True:\n    run()'},
            {type: 'text', value: '\nThanks'},
        ]);
    });

    it('leaves inline backticks and unfinished fences as ordinary text', () => {
        expect(splitUserMessageCode('Use `x` and ```unfinished')).toEqual([
            {type: 'text', value: 'Use `x` and ```unfinished'},
        ]);
    });
});
