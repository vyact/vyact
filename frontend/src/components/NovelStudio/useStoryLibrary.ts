import {useCallback, useEffect, useRef, useState} from 'react';
import {createStory, type Story} from './storyStorage';
import {fetchStories, flushStorySaves, queueStoryChanges, subscribeStorySaves} from './storyRepository';

export default function useStoryLibrary(defaultTitle: string, defaultChapter: string) {
    const [stories, setStoryState] = useState<Story[]>([]);
    const storyRef = useRef<Story[]>([]);
    const defaults = useRef({defaultTitle, defaultChapter});
    const [loading, setLoading] = useState(true);
    const [loadFailed, setLoadFailed] = useState(false);
    const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'error'>('saved');
    const mounted = useRef(false);
    const loadVersion = useRef(0);
    const load = useCallback(async () => {
        const version = ++loadVersion.current;
        try {
            const stored = await fetchStories();
            if (!mounted.current || version !== loadVersion.current) return;
            const next = stored.length ? stored : [createStory(defaults.current.defaultTitle, defaults.current.defaultChapter)];
            storyRef.current = next; setStoryState(next); setLoadFailed(false);
            if (!stored.length) queueStoryChanges([], next);
        } catch {if (mounted.current && version === loadVersion.current) setLoadFailed(true);}
        finally {if (mounted.current && version === loadVersion.current) setLoading(false);}
    }, []);
    useEffect(() => {
        mounted.current = true;
        const unsubscribe = subscribeStorySaves(setSaveStatus);
        void load();
        return () => {mounted.current = false; unsubscribe(); void flushStorySaves().catch(() => {});};
    }, [load]);
    const setStories = (update: (items: Story[]) => Story[]) => {
        if (loading || loadFailed) return;
        const previous = storyRef.current;
        const next = update(previous);
        storyRef.current = next; setStoryState(next);
        queueStoryChanges(previous, next);
    };
    const reload = () => {setLoading(true); setLoadFailed(false); return load();};
    return {stories, getStories: () => storyRef.current, setStories, loading, loadFailed, saveStatus, reload};
}
