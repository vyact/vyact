import {useEffect, useRef} from 'react';

export default function useStockAnalysisShortcut(key: string, onOpen: () => void, disabled = false, allowedModalSelector?: string) {
    const current = useRef({onOpen, disabled, allowedModalSelector});
    current.current = {onOpen, disabled, allowedModalSelector};
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.defaultPrevented || event.isComposing || !(event.metaKey || event.ctrlKey)
                || !event.shiftKey || event.altKey || (event.code !== `Key${key.toUpperCase()}` && event.key.toLowerCase() !== key.toLowerCase())) return;
            event.preventDefault();
            if (event.repeat || current.current.disabled) return;
            const modals = document.querySelectorAll('.app-modal-overlay');
            const topModal = modals[modals.length - 1];
            if (topModal && (!current.current.allowedModalSelector || !topModal.matches(current.current.allowedModalSelector))) return;
            current.current.onOpen();
        };
        window.addEventListener('keydown', handleKeyDown, true);
        return () => window.removeEventListener('keydown', handleKeyDown, true);
    }, [key]);
}
