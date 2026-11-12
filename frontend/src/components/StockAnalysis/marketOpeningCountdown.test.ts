import {expect, it} from 'vitest';
import {marketOpeningCountdown} from './marketOpeningCountdown';

it('counts down to premarket before 04:00 ET and regular open afterward', () => {
    const opening = Date.parse('2026-11-12T14:30:00Z') / 1000;
    const before = marketOpeningCountdown(opening, Date.parse('2026-11-12T08:40:00Z'), true);
    expect(before.stage).toBe('premarketUpcoming');
    expect(before.target).toBe(Date.parse('2026-11-12T09:00:00Z') / 1000);
    const active = marketOpeningCountdown(opening, Date.parse('2026-11-12T09:00:00Z'), true);
    expect(active.stage).toBe('premarketActive');
    expect(active.target).toBe(opening);
});
it('uses the supplied trading-day opening during DST and across weekends', () => {
    const opening = Date.parse('2026-07-06T13:30:00Z') / 1000;
    const countdown = marketOpeningCountdown(opening, Date.parse('2026-07-04T12:00:00Z'), true);
    expect(countdown.target).toBe(Date.parse('2026-07-06T08:00:00Z') / 1000);
    expect(countdown.stage).toBe('premarketUpcoming');
});
it('retains the regular opening for other markets', () => {
    const opening = Date.parse('2026-11-13T00:00:00Z') / 1000;
    expect(marketOpeningCountdown(opening, Date.parse('2026-11-12T10:00:00Z'), false))
        .toMatchObject({stage: 'regularUpcoming', target: opening});
});
