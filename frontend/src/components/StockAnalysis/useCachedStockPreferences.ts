import {useEffect, useRef, useState, type SetStateAction} from 'react';
import {assertOk} from '../../utils/apiError';

export default function useCachedStockPreferences<T>(endpoint: string, storageKey: string, normalize: (value: unknown) => T[]) {
    const [items, updateItems] = useState<T[]>(() => {
        try {return normalize(JSON.parse(localStorage.getItem(storageKey) ?? '[]'));} catch {return [];}
    });
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [saveAttempt, setSaveAttempt] = useState(0);
    const loadedRef = useRef(false);
    const current = useRef(items);
    const pendingEdits = useRef<SetStateAction<T[]>[]>([]);
    const saved = useRef<string | undefined>(undefined);
    const pendingWrites = useRef(0);
    const writes = useRef(Promise.resolve());
    const setItems = (change: SetStateAction<T[]>) => {
        if (!loadedRef.current) pendingEdits.current.push(change);
        const next = normalize(typeof change === 'function' ? change(current.current) : change);
        current.current = next;
        updateItems(next);
    };
    useEffect(() => {
        const controller = new AbortController();
        setFailed(false);
        fetch(`/api/stock-analysis/${endpoint}`, {signal: controller.signal, cache: 'no-store'})
            .then(async response => {await assertOk(response); return response.json() as Promise<{items: unknown[] | null}>;}).then(result => {
            if (controller.signal.aborted) return;
            const remote = result.items === null ? null : normalize(result.items);
            let next = remote ?? current.current;
            saved.current = remote === null ? undefined : JSON.stringify(remote);
            // Apply edits made while loading to the server snapshot, preserving remote order.
            if (remote !== null) {
                for (const change of pendingEdits.current) next = typeof change === 'function' ? change(next) : change;
            }
            pendingEdits.current = [];
            next = normalize(next);
            loadedRef.current = true;
            current.current = next;
            updateItems(next);
            setLoaded(true);
        }).catch(() => {if (!controller.signal.aborted) setFailed(true);});
        return () => controller.abort();
    }, [loadAttempt, endpoint, normalize]);
    useEffect(() => {
        try {localStorage.setItem(storageKey, JSON.stringify(items));} catch { /* Cache is optional. */ }
        if (!loaded) return;
        const signature = JSON.stringify(items);
        if (saved.current === signature && pendingWrites.current === 0) return;
        // Serialize writes so an older request cannot overwrite a newer order.
        pendingWrites.current += 1;
        writes.current = writes.current.then(async () => {
            try {
                const response = await fetch(`/api/stock-analysis/${endpoint}`, {method: 'PUT', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({items})});
                await assertOk(response);
                saved.current = signature;
                if (JSON.stringify(current.current) === signature) setFailed(false);
            } catch {
                if (JSON.stringify(current.current) === signature) setFailed(true);
            } finally {pendingWrites.current -= 1;}
        });
    }, [items, loaded, saveAttempt, endpoint, storageKey]);
    return {items, setItems, failed, retry: () => {
        setFailed(false);
        if (loadedRef.current) setSaveAttempt(value => value + 1);
        else setLoadAttempt(value => value + 1);
    }};
}
