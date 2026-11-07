import {describe, expect, it} from 'vitest';
import {quoteChange} from './ChartQuoteDetails';

describe('candle change compared with previous bar', () => {
    it('matches the Apple close-to-close change', () => {
        expect(quoteChange(342.37, 344.17)).toBeCloseTo(-0.52, 2);
    });
    it('uses the previous bar close for aggregated candles too', () => {
        expect(quoteChange(120, 100)).toBeCloseTo(20);
        expect(quoteChange(80, 100)).toBeCloseTo(-20);
    });
    it('omits rates when there is no valid previous bar', () => {
        expect(quoteChange(100, undefined)).toBeNull();
        expect(quoteChange(100, 0)).toBeNull();
        expect(quoteChange(null, 100)).toBeNull();
    });
});
