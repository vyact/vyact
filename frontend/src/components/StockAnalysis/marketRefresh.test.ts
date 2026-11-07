import {describe, expect, it} from 'vitest';
import {isMarketWeekend} from './marketRefresh';

describe('market-local weekends', () => {
    it('keeps refreshing US on Friday when Korea is already Saturday', () => {
        const now = new Date('2026-11-06T16:00:00Z');
        expect(isMarketWeekend('KR', now)).toBe(true);
        expect(isMarketWeekend('US', now)).toBe(false);
    });
    it('resumes Korea on Monday while New York is still Sunday', () => {
        const now = new Date('2026-11-08T16:00:00Z');
        expect(isMarketWeekend('KR', now)).toBe(false);
        expect(isMarketWeekend('US', now)).toBe(true);
    });
    it('uses New York daylight saving time for the weekend boundary', () => {
        expect(isMarketWeekend('US', new Date('2026-07-04T03:59:00Z'))).toBe(false);
        expect(isMarketWeekend('US', new Date('2026-07-04T04:00:00Z'))).toBe(true);
    });
});
