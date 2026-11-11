import {describe, expect, it} from 'vitest';
import {normalizePinnedIndices, movePinnedIndex, parseIndexDrag, pinnedIndexId, reorderPinnedIndex, appendPinnedIndex} from './pinnedIndexPreferences';

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

it('limits new pins to six while allowing reordering existing pins', () => {
    const five = normalizePinnedIndices([sp, nasdaq, taiwan, {market: 'KR', symbol: 'KS11'}, {market: 'HK', symbol: 'HSI'}, {market: 'CN', symbol: '000001.SS'}]);
    expect(movePinnedIndex(five, {market: 'JP', symbol: 'N225'})).toEqual(five);
    expect(movePinnedIndex(five, sp).map(pinnedIndexId)).toEqual([...five.slice(1), sp].map(pinnedIndexId));
    expect(normalizePinnedIndices([...five, {market: 'JP', symbol: 'N225'}])).toEqual(five);
});

it('reorders adjacent cards in either direction and ignores dropping on itself', () => {
    const hangSeng = {market: 'HK' as const, symbol: 'HSI'};
    expect(reorderPinnedIndex([nasdaq, hangSeng], hangSeng, pinnedIndexId(nasdaq))).toEqual([hangSeng, nasdaq]);
    expect(reorderPinnedIndex([nasdaq, hangSeng], nasdaq, pinnedIndexId(hangSeng))).toEqual([hangSeng, nasdaq]);
    expect(reorderPinnedIndex([nasdaq, hangSeng], hangSeng, pinnedIndexId(hangSeng))).toEqual([nasdaq, hangSeng]);
});

it('appends external indices and leaves an already pinned index in place', () => {
    expect(appendPinnedIndex([sp, nasdaq], taiwan)).toEqual([sp, nasdaq, taiwan]);
    expect(appendPinnedIndex([sp, nasdaq], sp)).toEqual([sp, nasdaq]);
});
