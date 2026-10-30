import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createStory} from './storyStorage';

beforeEach(() => {vi.resetModules(); vi.useFakeTimers();});
afterEach(() => {vi.useRealTimers(); vi.unstubAllGlobals();});

describe('ES-backed story persistence', () => {
    it('saves other stories even when one story fails validation', async () => {
        const invalid = createStory('Invalid', 'One');
        const valid = createStory('Valid', 'Two');
        const fetcher = vi.fn().mockResolvedValueOnce(new Response('', {status: 422})).mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetcher);
        const repository = await import('./storyRepository');
        repository.queueStoryChanges([], [invalid, valid]);
        await expect(repository.flushStorySaves()).rejects.toThrow();
        expect(fetcher.mock.calls.map(call => call[0])).toEqual([
            `/api/novel-studio/stories/${invalid.id}`, `/api/novel-studio/stories/${valid.id}`,
        ]);
        await repository.flushStorySaves();
        expect(fetcher.mock.calls[2][0]).toContain(invalid.id);
        expect(fetcher).toHaveBeenCalledTimes(3);
    });
    it('loads server stories and rejects unavailable storage rather than returning an empty library', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({stories: [{id: 'server-story'}]}))).mockResolvedValueOnce(new Response('', {status: 503}));
        vi.stubGlobal('fetch', fetcher);
        const repository = await import('./storyRepository');
        expect(await repository.fetchStories()).toEqual([{id: 'server-story'}]);
        await expect(repository.fetchStories()).rejects.toThrow();
    });
    it('coalesces edits and retains the last complete manuscript', async () => {
        const fetcher = vi.fn().mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetcher);
        const repository = await import('./storyRepository');
        const first = createStory('Book', 'One');
        const latest = {...first, chapters: [{...first.chapters[0], text: 'Final prose'}]};
        repository.queueStoryChanges([], [first]);
        repository.queueStoryChanges([first], [latest]);
        await repository.flushStorySaves();
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(fetcher.mock.calls[0][1].method).toBe('PUT');
        expect(JSON.parse(fetcher.mock.calls[0][1].body)).toEqual(latest);
    });
    it('orders deletion after an in-flight write so an old save cannot resurrect the story', async () => {
        let complete!: (response: Response) => void;
        const fetcher = vi.fn().mockImplementationOnce(() => new Promise<Response>(resolve => {complete = resolve;})).mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetcher);
        const repository = await import('./storyRepository');
        const story = createStory('Book', 'One');
        repository.queueStoryChanges([], [story]);
        const saving = repository.flushStorySaves();
        repository.queueStoryChanges([story], []);
        complete(new Response('{}'));
        await saving;
        expect(fetcher.mock.calls.map(call => call[1].method)).toEqual(['PUT', 'DELETE']);
    });
    it('keeps failed writes for explicit retry', async () => {
        const fetcher = vi.fn().mockResolvedValueOnce(new Response('', {status: 503})).mockResolvedValue(new Response('{}'));
        vi.stubGlobal('fetch', fetcher);
        const repository = await import('./storyRepository');
        const statuses: string[] = [];
        repository.subscribeStorySaves(status => statuses.push(status));
        repository.queueStoryChanges([], [createStory('Book', 'One')]);
        await expect(repository.flushStorySaves()).rejects.toThrow();
        expect(statuses[statuses.length - 1]).toBe('error');
        await repository.flushStorySaves();
        expect(statuses[statuses.length - 1]).toBe('saved');
        expect(fetcher).toHaveBeenCalledTimes(2);
    });
});
