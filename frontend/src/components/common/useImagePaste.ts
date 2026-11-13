import {useEffect} from 'react';

// Image paste belongs to the open analysis panel, regardless of input focus.
export default function useImagePaste(enabled: boolean, onPaste: (event: ClipboardEvent) => void): void {
    useEffect(() => {
        if (!enabled) return;
        const paste = (event: ClipboardEvent) => {
            if (event.defaultPrevented || !event.clipboardData) return;
            if (!Array.from(event.clipboardData.items).some(item => item.type.startsWith('image/'))) return;
            onPaste(event);
        };
        document.addEventListener('paste', paste);
        return () => document.removeEventListener('paste', paste);
    }, [enabled, onPaste]);
}
