import {afterEach, describe, expect, it, vi} from 'vitest';
import {downloadNovel} from './storyExport';
import {createStory} from './storyStorage';

afterEach(() => {vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();});
describe('novel downloads', () => {
    it('requests a per-chapter ZIP for whole-story exports and uses the server filename', async () => {
        vi.useFakeTimers();
        const story = createStory('Book', 'Chapter');
        const click = vi.fn();
        const link = {href: '', download: '', click};
        vi.stubGlobal('document', {createElement: () => link});
        vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:download');
        vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
        const fetcher = vi.fn().mockResolvedValue(new Response('ZIP', {headers: {'Content-Disposition': "attachment; filename*=UTF-8''Book_pdf.zip"}}));
        vi.stubGlobal('fetch', fetcher);
        await downloadNovel(story, 'pdf');
        const request = JSON.parse(fetcher.mock.calls[0][1].body);
        expect(request.format).toBe('pdf');
        expect(request.chapter_id).toBeUndefined();
        expect(link.download).toBe('Book_pdf.zip');
        expect(click).toHaveBeenCalledOnce();
        await vi.runAllTimersAsync();
    });
    it('surfaces export errors instead of downloading an error response', async () => {
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', {status: 500})));
        await expect(downloadNovel(createStory('Book', 'One'), 'md', 'chapter-id')).rejects.toThrow();
    });
});
