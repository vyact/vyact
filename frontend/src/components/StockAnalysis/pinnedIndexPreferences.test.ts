import {describe, expect, it} from 'vitest';
import {normalizePinnedIndices, movePinnedIndex, parseIndexDrag, pinnedIndexId} from './pinnedIndexPreferences';

const sp = {market: 'US' as const, symbol: 'GSPC'};
const nasdaq = {market: 'US' as const, symbol: 'IXIC'};
const taiwan = {market: 'TW' as const, symbol: 'TWII'};

describe('pinned index preferences', () => {
    it('validates saved indices against their markets and removes duplicates', () => {
        expect(normalizePinnedIndices([sp, sp, taiwan, {market: 'TW', symbol: 'GSPC'}, null])).toEqual([sp, taiwan]);
        expect(normalizePinnedIndices({})).toEqual([]);
    });
    it('appends newly pinned cards and moves existing cards before or after a target', () => {
        expect(movePinnedIndex([sp], nasdaq)).toEqual([sp, nasdaq]);
        expect(movePinnedIndex([sp, nasdaq, taiwan], taiwan, pinnedIndexId(sp))).toEqual([taiwan, sp, nasdaq]);
        expect(movePinnedIndex([sp, nasdaq, taiwan], sp, pinnedIndexId(taiwan), true)).toEqual([nasdaq, taiwan, sp]);
    });
    it('does not duplicate an existing card or reorder a card onto itself', () => {
        expect(movePinnedIndex([sp, nasdaq], sp)).toEqual([nasdaq, sp]);
        expect(movePinnedIndex([sp, nasdaq], sp, pinnedIndexId(sp))).toEqual([sp, nasdaq]);
    });
    it('distinguishes pinned drags for removal and rejects invalid payloads', () => {
        expect(parseIndexDrag(JSON.stringify({...sp, pinned: true}))).toEqual({...sp, pinned: true});
        expect(parseIndexDrag(JSON.stringify(sp))).toEqual({...sp, pinned: false});
        expect(parseIndexDrag('invalid')).toBeUndefined();
        expect(parseIndexDrag(JSON.stringify({market: 'CN', symbol: 'AAPL'}))).toBeUndefined();
    });
});
