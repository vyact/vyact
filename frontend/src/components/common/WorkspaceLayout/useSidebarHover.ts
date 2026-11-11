import {useCallback, useEffect, useRef, useState} from 'react';

const SIDEBAR_HOVER_DELAY_MS = 120;

export default function useSidebarHover(collapsed: boolean) {
    const [visible, setVisible] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const dismiss = useCallback(() => {
        clearTimeout(timer.current);
        setVisible(false);
    }, []);
    const onEnter = useCallback(() => {
        clearTimeout(timer.current);
        if (collapsed) timer.current = setTimeout(() => setVisible(true), SIDEBAR_HOVER_DELAY_MS);
    }, [collapsed]);
    const onLeave = useCallback(() => {
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setVisible(false), SIDEBAR_HOVER_DELAY_MS);
    }, []);
    useEffect(() => {
        return () => clearTimeout(timer.current);
    }, []);
    return {visible: collapsed && visible, onEnter, onLeave, dismiss};
}
