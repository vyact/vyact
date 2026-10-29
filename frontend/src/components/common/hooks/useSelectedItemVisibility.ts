import {useLayoutEffect, useRef} from 'react';

/** Reveal the selected row without scrolling unrelated ancestor panels. */
export default function useSelectedItemVisibility(selectedId: string, itemCount: number) {
    const containerRef = useRef<HTMLDivElement>(null);
    const selectedItemRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const container = containerRef.current;
        const selected = selectedItemRef.current;
        if (!container || !selected) return;
        const viewport = container.getBoundingClientRect();
        const row = selected.getBoundingClientRect();
        if (row.bottom > viewport.bottom) container.scrollTop += row.bottom - viewport.bottom;
        else if (row.top < viewport.top) container.scrollTop -= viewport.top - row.top;
    }, [selectedId, itemCount]);
    return {containerRef, selectedItemRef};
}
