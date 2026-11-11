import {useEffect, useRef, useState, type SetStateAction} from 'react';
import {stockAnalysis} from '../../services/stockAnalysis';
import {normalizePinnedIndices, PINNED_INDICES_KEY, type PinnedMarketIndex} from './pinnedIndexPreferences';

export default function usePinnedIndexPreferences() {
    const [items, updateItems] = useState<PinnedMarketIndex[]>(() => {
        try {return normalizePinnedIndices(JSON.parse(localStorage.getItem(PINNED_INDICES_KEY) ?? '[]'));} catch {return [];}
    });
    const [loaded, setLoaded] = useState(false);
    const [failed, setFailed] = useState(false);
    const [loadAttempt, setLoadAttempt] = useState(0);
    const [saveAttempt, setSaveAttempt] = useState(0);
    const loadedRef = useRef(false);
    const current = useRef(items);
    const pendingEdits = useRef<SetStateAction<PinnedMarketIndex[]>[]>([]);
    const saved = useRef<string | undefined>(undefined);
    const pendingWrites = useRef(0);
    const writes = useRef(Promise.resolve());
    const setItems = (change: SetStateAction<PinnedMarketIndex[]>) => {
        if (!loadedRef.current) pendingEdits.current.push(change);
        const next = normalizePinnedIndices(typeof change === 'function' ? change(current.current) : change);
        current.current = next;
        updateItems(next);
    };
    useEffect(() => {
        const controller = new AbortController();
        setFailed(false);
        stockAnalysis.pinnedIndices(controller.signal).then(result => {
            if (controller.signal.aborted) return;
            const remote = result.items === null ? null : normalizePinnedIndices(result.items);
            let next = remote ?? current.current;
            saved.current = remote === null ? undefined : JSON.stringify(remote);
            // Apply edits made while loading to the server snapshot, preserving remote order.
            if (remote !== null) {
                for (const change of pendingEdits.current) next = typeof change === 'function' ? change(next) : change;
            }
            pendingEdits.current = [];
            next = normalizePinnedIndices(next);
            loadedRef.current = true;
            current.current = next;
            updateItems(next);
            setLoaded(true);
        }).catch(() => {if (!controller.signal.aborted) setFailed(true);});
        return () => controller.abort();
    }, [loadAttempt]);
    useEffect(() => {
        try {localStorage.setItem(PINNED_INDICES_KEY, JSON.stringify(items));} catch { /* Cache is optional. */ }
        if (!loaded) return;
        const signature = JSON.stringify(items);
        if (saved.current === signature && pendingWrites.current === 0) return;
        // Serialize writes so an older request cannot overwrite a newer order.
        pendingWrites.current += 1;
        writes.current = writes.current.then(async () => {
            try {
                await stockAnalysis.savePinnedIndices(items);
                saved.current = signature;
                if (JSON.stringify(current.current) === signature) setFailed(false);
            } catch {
                if (JSON.stringify(current.current) === signature) setFailed(true);
            } finally {pendingWrites.current -= 1;}
        });
    }, [items, loaded, saveAttempt]);
    return {items, setItems, failed, retry: () => {
        setFailed(false);
        if (loadedRef.current) setSaveAttempt(value => value + 1);
        else setLoadAttempt(value => value + 1);
    }};
}
