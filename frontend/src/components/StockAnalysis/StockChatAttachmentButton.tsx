import {LoaderCircle, Paperclip} from 'lucide-react';
import './StockChatAttachmentButton.css';

export default function StockChatAttachmentButton({label, disabled, capturing, onClick}: {
    label: string;
    disabled: boolean;
    capturing: boolean;
    onClick: () => void;
}) {
    return <button type="button" className="modal-action-cancel stock-chat-attachment-button"
        aria-label={label} title={label} disabled={disabled} aria-busy={capturing} onClick={onClick}>
        {capturing
            ? <LoaderCircle className="stock-chat-attachment-spinner" aria-hidden="true"/>
            : <Paperclip aria-hidden="true"/>}
    </button>;
}
