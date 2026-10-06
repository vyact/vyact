import {describe, expect, it} from 'vitest';
import {getToolStopMessage} from './toolStop';

describe('tool stop messages', () => {
    it.each([
        ['tool_repeat_blocked', 'toolRepeatBlocked'],
        ['tool_failures_exhausted', 'toolFailuresExhausted'],
        ['tool_round_limit', 'toolRoundLimit'],
    ])('maps %s to its specific reason', (code, key) => {
        expect(getToolStopMessage(code, key => key)).toEqual({
            title: `message.${key}Title`, description: `message.${key}Description`,
        });
    });
    it('leaves unrelated model errors to the existing handler', () => {
        expect(getToolStopMessage('model_no_response', key => key)).toBeUndefined();
        expect(getToolStopMessage(undefined, key => key)).toBeUndefined();
    });
});
