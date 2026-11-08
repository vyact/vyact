import {describe, expect, it} from 'vitest';
import {normalizeStockGroups, STOCK_GROUP_SIZE_LIMIT} from './useStockGroups';

describe('stock group persistence', () => {
    it('keeps market-specific groups and stock membership with trimmed names', () => {
        expect(normalizeStockGroups([{id: 'kr', market: 'KR', name: ' 반도체 ', symbols: ['005930', '000660', '005930']},
            {id: 'us', market: 'US', name: 'Technology', symbols: ['AAPL']}])).toEqual([
            {id: 'kr', market: 'KR', name: '반도체', symbols: ['005930', '000660']},
            {id: 'us', market: 'US', name: 'Technology', symbols: ['AAPL']},
        ]);
    });
    it('rejects corrupt groups, duplicate ids and invalid stock codes without losing valid groups', () => {
        expect(normalizeStockGroups([null, {}, {id: 'a', market: 'KR', name: ' ', symbols: []},
            {id: 'b', market: 'US', name: 'One', symbols: ['AAPL', null, '^GSPC', '<script>']},
            {id: 'b', market: 'KR', name: 'Two', symbols: []}])).toEqual([{id: 'b', market: 'US', name: 'One', symbols: ['AAPL']}]);
        expect(normalizeStockGroups(null)).toEqual([]);
    });
    it('bounds member count while allowing empty groups to be edited later', () => {
        const groups = normalizeStockGroups([{id: 'a', market: 'KR', name: 'Group', symbols: Array.from({length: 150}, (_, index) => String(index))},
            {id: 'b', market: 'KR', name: 'Empty', symbols: []}]);
        expect(groups[0].symbols).toHaveLength(STOCK_GROUP_SIZE_LIMIT);
        expect(groups[1].symbols).toEqual([]);
    });
});
