import {useLayoutEffect, useId, useRef} from 'react';
import {LoaderCircle} from 'lucide-react';
import ModalOverlay from '../ModalOverlay/ModalOverlay';
import './ProcessingModal.css';

interface ProcessingModalProps {
    title: string;
    detail?: string;
}

export default function ProcessingModal({title, detail}: ProcessingModalProps) {
    const headingId = useId();
    const panelRef = useRef<HTMLDivElement>(null);
    useLayoutEffect(() => {
        const panel = panelRef.current;
        if (!panel) return;
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        const background = new Map<HTMLElement, boolean>();
        let ancestor: HTMLElement = panel;
        while (ancestor.parentElement) {
            for (const sibling of ancestor.parentElement.children) {
                if (sibling instanceof HTMLElement && sibling !== ancestor) {
                    background.set(sibling, sibling.inert);
                    sibling.inert = true;
                }
            }
            ancestor = ancestor.parentElement;
            if (ancestor === document.body) break;
        }
        const keepFocus = (event: FocusEvent) => {
            if (!panel.contains(event.target as Node)) panel.focus();
        };
        const blockKeyboard = (event: KeyboardEvent) => {
            event.preventDefault();
            event.stopImmediatePropagation();
            panel.focus();
        };
        panel.focus();
        document.addEventListener('focusin', keepFocus, true);
        window.addEventListener('keydown', blockKeyboard, true);
        return () => {
            document.removeEventListener('focusin', keepFocus, true);
            window.removeEventListener('keydown', blockKeyboard, true);
            background.forEach((wasInert, element) => {element.inert = wasInert;});
            if (previousFocus?.isConnected) previousFocus.focus();
        };
    }, []);
    return <ModalOverlay aria-labelledby={headingId} onClose={() => {}} captureEscape>
        <div className="processing-modal" ref={panelRef} tabIndex={-1}>
            <div className="processing-modal-heading" role="status" aria-live="polite">
                <span className="processing-modal-icon"><LoaderCircle size={22} aria-hidden="true"/></span>
                <div><h2 id={headingId}>{title}</h2>{detail && <p title={detail}>{detail}</p>}</div>
            </div>
            <div className="processing-modal-track" aria-hidden="true"><span/></div>
        </div>
    </ModalOverlay>;
}
