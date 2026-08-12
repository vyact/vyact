export const getTopmostModalOverlay = (): HTMLElement | null => {
    const openOverlays = Array.from(document.querySelectorAll<HTMLElement>('.app-modal-overlay'));
    return openOverlays.reduce<HTMLElement | null>((topmost, overlay) => {
        if (!topmost) return overlay;
        const overlayZIndex = Number.parseInt(window.getComputedStyle(overlay).zIndex, 10) || 0;
        const topmostZIndex = Number.parseInt(window.getComputedStyle(topmost).zIndex, 10) || 0;
        return overlayZIndex >= topmostZIndex ? overlay : topmost;
    }, null);
};
