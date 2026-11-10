import {describe, expect, it} from 'vitest';
import {formatTimeUntilOpen} from './MarketOpenCountdown';
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

it('uses Tokyo time for Japanese weekends', () => {
    expect(isMarketWeekend('JP', new Date('2026-11-08T15:00:00Z'))).toBe(false);
    expect(isMarketWeekend('JP', new Date('2026-11-06T15:00:00Z'))).toBe(true);
});

describe('regular market countdown', () => {
    const now = Date.parse('2026-11-09T10:00:00Z');
    it('formats remaining hours and minutes in the selected language', () => {
        const opening = (now + (3 * 60 + 20) * 60_000) / 1000;
        expect(formatTimeUntilOpen(opening, now, 'en')).toBe('3 hr 20 min');
        expect(formatTimeUntilOpen(opening, now, 'ko')).toBe('3시간 20분');
    });
    it('rounds partial minutes up and disappears at the opening time', () => {
        expect(formatTimeUntilOpen((now + 1) / 1000, now, 'en')).toBe('1 min');
        expect(formatTimeUntilOpen(now / 1000, now, 'en')).toBeNull();
        expect(formatTimeUntilOpen((now - 1) / 1000, now, 'en')).toBeNull();
    });
});
