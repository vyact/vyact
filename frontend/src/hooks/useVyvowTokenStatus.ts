import {useEffect, useState} from 'react';
import {api} from '../services/api';
import {VYVOW_TOKEN_CHANGED} from '../services/vyvow';

export default function useVyvowTokenStatus(enabled = true): boolean {
    const [hasToken, setHasToken] = useState(false);
    useEffect(() => {
        if (!enabled) return;
        let active = true;
        let changed = false;
        const handleChange = (event: Event) => {
            changed = true;
            setHasToken((event as CustomEvent<unknown>).detail === true);
        };
        window.addEventListener(VYVOW_TOKEN_CHANGED, handleChange);
        api.getVyvowTokenStatus().then(status => {
            if (active && !changed) setHasToken(status.has_token);
        }).catch(() => { if (active && !changed) setHasToken(false); });
        return () => {
            active = false;
            window.removeEventListener(VYVOW_TOKEN_CHANGED, handleChange);
        };
    }, [enabled]);
    return enabled && hasToken;
}
