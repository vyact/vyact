import {useCallback, useLayoutEffect, useRef, type MouseEvent, type RefObject} from 'react';

const PREVIEW_MARGIN = 8;
export const PREVIEW_POINTER_GAP = 80;
export function sectorPreviewLeft(pointerX: number, width: number, panelWidth: number): number {
    const maximum = Math.max(PREVIEW_MARGIN, width - panelWidth - PREVIEW_MARGIN);
    const right = pointerX + PREVIEW_POINTER_GAP;
    const left = pointerX - panelWidth - PREVIEW_POINTER_GAP;
    if (right + panelWidth <= width - PREVIEW_MARGIN) return Math.max(PREVIEW_MARGIN, right);
    if (left >= PREVIEW_MARGIN) return Math.min(maximum, left);
    // A narrow map may not fit the panel on either side; keep it within bounds.
    const preferred = pointerX < width / 2 ? right : left;
    return Math.max(PREVIEW_MARGIN, Math.min(maximum, preferred));
}

export function sectorPreviewTop(pointerY: number, height: number, panelHeight: number): number {
    return Math.max(PREVIEW_MARGIN, Math.min(pointerY, height - panelHeight - PREVIEW_MARGIN));
}

export default function useSectorPreviewPosition(surface: RefObject<HTMLDivElement | null>, panel: RefObject<HTMLElement | null>,
    width: number, height: number, panelWidth: number, previewKey?: string) {
    const pointer = useRef<{x: number; y: number} | undefined>(undefined);
    const apply = useCallback(() => {
        const element = panel.current;
        if (!pointer.current || !element) return;
        element.style.setProperty('--stock-preview-left', `${sectorPreviewLeft(pointer.current.x, width, panelWidth)}px`);
        element.style.setProperty('--stock-preview-top', `${sectorPreviewTop(pointer.current.y, height, element.offsetHeight)}px`);
    }, [panel, width, height, panelWidth]);
    useLayoutEffect(() => {
        apply();
        if (!panel.current) return;
        const observer = new ResizeObserver(apply);
        observer.observe(panel.current);
        return () => observer.disconnect();
    }, [apply, panel, previewKey]);
    return {
        onMouseMove: (event: MouseEvent<HTMLDivElement>) => {
            const bounds = surface.current?.getBoundingClientRect();
            if (!bounds) return;
            pointer.current = {x: event.clientX - bounds.left, y: event.clientY - bounds.top};
            apply();
        },
        onFocusCapture: () => {
            pointer.current = undefined;
            panel.current?.style.removeProperty('--stock-preview-left');
            panel.current?.style.removeProperty('--stock-preview-top');
        },
    };
}
