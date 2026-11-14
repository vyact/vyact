import {describe, expect, it} from 'vitest';
import {sampleGroupStocks} from './groupSampling';

describe('sampleGroupStocks', () => {
    it('selects descending weights per group and preserves original membership', () => {
        const groups = [{id: 'a', name: 'A', market: 'US' as const, symbols: ['A', 'B', 'C']},
            {id: 'b', name: 'B', market: 'US' as const, symbols: ['C', 'D']}];
        const result = sampleGroupStocks(groups, {A: 1, B: 10, C: 5, D: 2}, 2);
        expect(result.map(group => group.symbols)).toEqual([['B', 'C'], ['C', 'D']]);
        expect(result[0].totalStocks).toBe(3);
        expect(result[0].selectionLimit).toBe(2);
        expect(groups[0].symbols).toEqual(['A', 'B', 'C']);
    });
    it('excludes unavailable weights', () => {
        const groups = [{id: 'a', name: 'A', market: 'KR' as const, symbols: ['A', 'B', 'C']}];
        expect(sampleGroupStocks(groups, {A: 0, B: Number.NaN}, 3)[0].symbols).toEqual([]);
    });
});
