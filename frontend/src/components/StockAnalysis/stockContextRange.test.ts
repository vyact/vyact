import {describe, expect, it} from 'vitest';
import {clampContextRange, normalizeContextRange} from './stockContextRange';

describe('saved context range', () => {
    it('rejects invalid dates and reversed ranges', () => {
        expect(normalizeContextRange({start: '2026-02-30', end: '2026-03-01'})).toBeNull();
        expect(normalizeContextRange({start: '2026-11-10', end: '2026-11-01'})).toBeNull();
        expect(normalizeContextRange(null)).toBeNull();
    });
    it('clamps saved dates to the new instrument history', () => {
        expect(clampContextRange({start: '2020-01-01', end: '2026-11-14'}, '2025-01-01', '2026-11-13'))
            .toEqual({start: '2025-01-01', end: '2026-11-13'});
        expect(clampContextRange({start: '2020-01-01', end: '2021-01-01'}, '2025-01-01', '2026-11-13'))
            .toEqual({start: '2025-01-01', end: '2025-01-01'});
    });
    it('preserves the range until history is available', () => {
        const range = {start: '2020-01-01', end: '2021-01-01'};
        expect(clampContextRange(range)).toEqual(range);
    });
});
