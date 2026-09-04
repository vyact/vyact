import {useSyncExternalStore} from 'react';

let activeMessageId: string | null = null;
const listeners = new Set<() => void>();
export function setAutoReadMessage(id: string | null) {
    activeMessageId = id;
    listeners.forEach(listener => listener());
}
export function useAutoReadMessage() {
    return useSyncExternalStore(listener => {
        listeners.add(listener);
        return () => { listeners.delete(listener); };
    }, () => activeMessageId);
}
