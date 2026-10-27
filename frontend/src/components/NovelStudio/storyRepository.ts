import type {Story} from './storyStorage';

const STORIES_ENDPOINT = '/api/novel-studio/stories';
const SAVE_DELAY_MS = 450;
type SaveStatus = 'saved' | 'saving' | 'error';
interface PendingWrite {story: Story | null; version: number}
const pending = new Map<string, PendingWrite>();
const listeners = new Set<(status: SaveStatus) => void>();
let timer: ReturnType<typeof setTimeout> | undefined;
let version = 0;
let inFlight: Promise<void> | null = null;
let status: SaveStatus = 'saved';

function notify(next: SaveStatus) {status = next; listeners.forEach(listener => listener(next));}
export function subscribeStorySaves(listener: (status: SaveStatus) => void) {
    listeners.add(listener); listener(status);
    return () => {listeners.delete(listener);};
}
export async function fetchStories(): Promise<Story[]> {
    await flushStorySaves();
    const response = await fetch(STORIES_ENDPOINT);
    if (!response.ok) throw new Error('Story load failed');
    const data = await response.json();
    if (!Array.isArray(data.stories)) throw new Error('Invalid story response');
    return data.stories;
}
export function queueStoryChanges(previous: Story[], next: Story[]) {
    const before = new Map(previous.map(story => [story.id, story]));
    const after = new Set(next.map(story => story.id));
    next.forEach(story => {
        if (before.get(story.id) !== story) pending.set(story.id, {story, version: ++version});
    });
    previous.forEach(story => {
        if (!after.has(story.id)) pending.set(story.id, {story: null, version: ++version});
    });
    if (!pending.size) return;
    notify('saving');
    clearTimeout(timer);
    timer = setTimeout(() => {void flushStorySaves().catch(() => {});}, SAVE_DELAY_MS);
}

/** One ordered writer survives workspace unmounts; older saves cannot overtake deletion or newer edits. */
export function flushStorySaves(): Promise<void> {
    clearTimeout(timer);
    if (inFlight) return inFlight;
    if (!pending.size) return Promise.resolve();
    notify('saving');
    inFlight = (async () => {
        try {
            while (pending.size) {
                const [id, write] = pending.entries().next().value!;
                const response = await fetch(`${STORIES_ENDPOINT}/${encodeURIComponent(id)}`, {
                    method: write.story ? 'PUT' : 'DELETE',
                    ...(write.story ? {headers: {'Content-Type': 'application/json'}, body: JSON.stringify(write.story)} : {}),
                });
                if (!response.ok) throw new Error('Story save failed');
                if (pending.get(id)?.version === write.version) pending.delete(id);
            }
            notify('saved');
        } catch (error) {notify('error'); throw error;}
        finally {inFlight = null;}
    })();
    return inFlight;
}
