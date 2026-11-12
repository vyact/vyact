import {useLayoutEffect, type RefObject} from 'react';

/** Refit wrapped text when its value or available width changes. */
export default function useAutoSizeTextarea(ref: RefObject<HTMLTextAreaElement | null>, value: string, maxHeight: number) {
    useLayoutEffect(() => {
        const input = ref.current;
        if (!input) return;
        const resize = () => {
            if (input.clientWidth === 0) return;
            input.style.height = 'auto';
            input.style.height = `${Math.min(input.scrollHeight, maxHeight)}px`;
        };
        resize();
        let previousWidth = input.clientWidth;
        const observer = new ResizeObserver(() => {
            const width = input.clientWidth;
            if (width === previousWidth) return;
            previousWidth = width;
            resize();
        });
        observer.observe(input);
        return () => observer.disconnect();
    }, [ref, value, maxHeight]);
}
