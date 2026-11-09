import {describe, expect, it} from 'vitest';
import {formatTimeUntilOpen} from './MarketOpenCountdown';

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
