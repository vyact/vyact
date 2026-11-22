import {useEffect} from 'react';

export default function useStockBackShortcut(enabled: boolean, onBack: () => void) {
    useEffect(() => {
        if (!enabled) return;
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || event.metaKey === event.ctrlKey
                || event.shiftKey || event.altKey || event.key !== 'ArrowLeft') return;
            const target = event.target;
            if (target instanceof HTMLElement && (target.isContentEditable
                || target.closest('input, textarea, select, [role="textbox"]'))) return;
            if (document.querySelector('.app-modal-overlay')) return;
            event.preventDefault();
            if (!event.repeat) onBack();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [enabled, onBack]);
}
