// US premarket begins at 04:00 ET, 5.5 hours before the regular opening.
// The regular opening comes from the exchange calendar, including holidays and DST.
export const US_PREMARKET_LEAD_SECONDS = (5 * 60 + 30) * 60;

export function marketOpeningCountdown(opening: number, now: number, includePremarket: boolean) {
    const premarketOpening = opening - US_PREMARKET_LEAD_SECONDS;
    if (includePremarket && now < premarketOpening * 1000) {
        return {stage: 'premarketUpcoming' as const, target: premarketOpening, premarketOpening};
    }
    return {stage: includePremarket ? 'premarketActive' as const : 'regularUpcoming' as const, target: opening, premarketOpening};
}
