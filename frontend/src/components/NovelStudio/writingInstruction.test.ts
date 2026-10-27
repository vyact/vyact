import {describe, expect, it} from 'vitest';
import {buildWritingInstruction} from './writingInstruction';

describe('task guidance and author direction', () => {
    it('keeps the default task when the author leaves the optional field empty', () => {
        expect(buildWritingInstruction('Develop the story premise.', '')).toBe('Develop the story premise.');
    });
    it('includes the task and author preferences without replacing either', () => {
        expect(buildWritingInstruction(' Develop characters. ', ' Keep the cast small. ')).toBe('Develop characters.\n\nKeep the cast small.');
    });
    it('allows a custom request without predefined task guidance', () => {
        expect(buildWritingInstruction('', 'Review this dialogue.')).toBe('Review this dialogue.');
        expect(buildWritingInstruction('', '  ')).toBe('');
    });
});
