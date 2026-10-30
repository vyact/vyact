import {useEffect, useId, useRef} from 'react';
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
    useEffect(() => {
        const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        panelRef.current?.focus();
        return () => {if (previousFocus?.isConnected) previousFocus.focus();};
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
