import {useEffect, useRef, useState} from 'react';

// Refresh independently of the polling interval, including after a suspended tab wakes.
export default function useMarketOpeningRefresh(opening: number | undefined, market: string) {
    const [version, setVersion] = useState(0);
    const refreshedOpening = useRef<string | undefined>(undefined);
    useEffect(() => {
        if (!opening || !Number.isFinite(opening)) return;
        const key = `${market}:${opening}`;
        const refreshIfOpen = () => {
            if (Date.now() < opening * 1000 || refreshedOpening.current === key) return;
            refreshedOpening.current = key;
            setVersion(current => current + 1);
        };
        const timer = window.setTimeout(refreshIfOpen, Math.max(0, opening * 1000 - Date.now()));
        document.addEventListener('visibilitychange', refreshIfOpen);
        window.addEventListener('focus', refreshIfOpen);
        return () => {
            window.clearTimeout(timer);
            document.removeEventListener('visibilitychange', refreshIfOpen);
            window.removeEventListener('focus', refreshIfOpen);
        };
    }, [opening, market]);
    return version;
}
