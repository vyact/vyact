import {useEffect, useRef, useState} from 'react';

const SCROLL_IDLE_DELAY_MS = 800;

export default function useScrollActivity() {
    const [scrolling, setScrolling] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    useEffect(() => () => clearTimeout(timer.current), []);
    const onScroll = () => {
        setScrolling(true);
        clearTimeout(timer.current);
        timer.current = setTimeout(() => setScrolling(false), SCROLL_IDLE_DELAY_MS);
    };
    return {scrolling, onScroll};
}
