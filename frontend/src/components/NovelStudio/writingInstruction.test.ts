import {describe, expect, it} from 'vitest';
import {AUTHOR_DIRECTION_MAX_LENGTH, TASK_GUIDANCE_MAX_LENGTH, buildWritingInstruction} from './writingInstruction';

describe('task guidance and author direction', () => {
    it('preserves 30,000 characters of source material plus the full automatic guidance', () => {
        const guidance = '지'.repeat(TASK_GUIDANCE_MAX_LENGTH);
        const direction = '사'.repeat(AUTHOR_DIRECTION_MAX_LENGTH - 2) + '끝!';
        const instruction = buildWritingInstruction(guidance, direction);
        expect(instruction).toHaveLength(32_502);
        expect(instruction).toBe(`${guidance}\n\n${direction}`);
    });
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
