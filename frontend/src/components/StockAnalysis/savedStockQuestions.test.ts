import {afterEach, expect, it, vi} from 'vitest';
import {loadSavedQuestions, normalizeSavedQuestions, saveQuestions} from './savedStockQuestions';

const item = {id: 'one', title: 'Financial review', question: 'Review this stock.'};
afterEach(() => vi.unstubAllGlobals());
it('rejects invalid records and duplicate ids', () => {
    expect(normalizeSavedQuestions([item, {...item}, null, {...item, id: 'two', title: ' '}, {...item, id: 'three', question: 'x'.repeat(4001)}])).toEqual([item]);
});
it('uses separate ES endpoints and caches only confirmed saves', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ok: true, json: async () => ({items: [item]})})
        .mockResolvedValueOnce({ok: true}).mockResolvedValueOnce(new Response('failure', {status: 500}));
    const setItem = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('localStorage', {setItem});
    expect(await loadSavedQuestions('stock', new AbortController().signal)).toEqual([item]);
    await saveQuestions('groups', [item]);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/stock-analysis/saved-questions/stock');
    expect(fetchMock.mock.calls[1][0]).toBe('/api/stock-analysis/saved-questions/groups');
    expect(setItem.mock.calls[0][0]).not.toBe(setItem.mock.calls[1][0]);
    await expect(saveQuestions('groups', [])).rejects.toThrow();
    expect(setItem).toHaveBeenCalledTimes(2);
});
it('treats missing server data as empty instead of resurrecting stale cache', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ok: true, json: async () => ({items: null})}));
    const setItem = vi.fn();
    vi.stubGlobal('localStorage', {setItem});
    expect(await loadSavedQuestions('stock', new AbortController().signal)).toEqual([]);
    expect(setItem).toHaveBeenCalledWith('vyact:stock-analysis:saved-questions:stock', '[]');
});
