import {useCallback, useEffect, useState} from 'react';

export type ReasoningEffort = 'none' | 'low' | 'medium' | 'high' | 'xhigh';
export type ReasoningValue = 'off' | 'on' | ReasoningEffort;
export interface ReasoningCapability {
    control: 'none' | 'toggle' | 'effort';
    efforts: Exclude<ReasoningEffort, 'none'>[];
    supports_none: boolean;
}

export const REASONING_STORAGE_KEY = 'vyactReasoningEnabled';
const REASONING_VALUE_STORAGE_KEY = 'vyactReasoningValue';
export const REASONING_CHANGED_EVENT = 'vyact:reasoning-changed';
const DEFAULT_REASONING_VALUE: ReasoningValue = 'off';

export function getReasoningValue(): ReasoningValue {
    try {
        const value = localStorage.getItem(REASONING_VALUE_STORAGE_KEY);
        if (value === 'off' || value === 'on' || value === 'none' || value === 'low' || value === 'medium' || value === 'high' || value === 'xhigh') return value;
        return localStorage.getItem(REASONING_STORAGE_KEY) === 'true' ? 'on' : DEFAULT_REASONING_VALUE;
    } catch {
        return DEFAULT_REASONING_VALUE;
    }
}

export function isReasoningActive(value: ReasoningValue = getReasoningValue()): boolean {
    return value !== 'off' && value !== 'none';
}

export function getReasoningEnabled(): boolean {
    return isReasoningActive();
}

export function getReasoningRequestValue(): boolean | ReasoningEffort {
    const value = getReasoningValue();
    if (value === 'off') return false;
    if (value === 'on') return true;
    return value;
}

export function setReasoningValue(value: ReasoningValue): void {
    try {
        localStorage.setItem(REASONING_VALUE_STORAGE_KEY, value);
        localStorage.setItem(REASONING_STORAGE_KEY, String(isReasoningActive(value)));
    } catch {
        // Keep the in-memory UI working when storage is unavailable.
    }
    window.dispatchEvent(new CustomEvent(REASONING_CHANGED_EVENT, {detail: {value}}));
}

export function defaultReasoningValue(capability: ReasoningCapability): ReasoningValue {
    if (capability.control === 'effort') return capability.supports_none ? 'none' : capability.efforts[0] ?? 'low';
    return 'off';
}

export function useReasoning(): [ReasoningValue, (value: ReasoningValue) => void] {
    const [value, setValue] = useState<ReasoningValue>(getReasoningValue);

    useEffect(() => {
        const syncValue = (event?: Event) => {
            const eventValue = (event as CustomEvent<{value?: ReasoningValue}> | undefined)?.detail?.value;
            setValue(eventValue ?? getReasoningValue());
        };
        const onStorage = (event: StorageEvent) => {
            if (event.key === REASONING_STORAGE_KEY || event.key === REASONING_VALUE_STORAGE_KEY) syncValue();
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener(REASONING_CHANGED_EVENT, syncValue);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener(REASONING_CHANGED_EVENT, syncValue);
        };
    }, []);

    const updateValue = useCallback((nextValue: ReasoningValue) => {
        setValue(nextValue);
        setReasoningValue(nextValue);
    }, []);
    return [value, updateValue];
}
