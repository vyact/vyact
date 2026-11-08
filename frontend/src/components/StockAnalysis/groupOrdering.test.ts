import {describe, expect, it} from 'vitest';
import {reorderGroups, reorderItems} from './groupOrdering';
import {normalizeStockGroups, type StockGroup} from './useStockGroups';

describe('stock group drag ordering', () => {
    it('inserts before or after a target in either direction without losing members', () => {
        expect(reorderItems(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
        expect(reorderItems(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
        expect(reorderItems(['a', 'b', 'c'], 'a', 'b', false)).toEqual(['a', 'b', 'c']);
        expect(reorderItems(['a', 'b'], 'missing', 'a', true)).toEqual(['a', 'b']);
    });
    it('reorders only the current market while preserving other markets and stored order', () => {
        const groups: StockGroup[] = [{id: 'a', market: 'KR', name: 'A', symbols: ['005930', '000660']},
            {id: 'us', market: 'US', name: 'US', symbols: ['AAPL']}, {id: 'b', market: 'KR', name: 'B', symbols: []}];
        const ordered = reorderGroups(groups, 'KR', 'a', 'b', true);
        expect(ordered.map(group => group.id)).toEqual(['b', 'us', 'a']);
        expect(normalizeStockGroups(JSON.parse(JSON.stringify(ordered)))).toEqual(ordered);
        expect(ordered[2].symbols).toEqual(['005930', '000660']);
    });
});
