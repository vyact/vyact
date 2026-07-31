import type {ReactNode} from 'react';
import './AttachmentItem.css';

interface AttachmentItemProps {
    name: string;
    leadingIcon: ReactNode;
    onOpen: () => void;
    openLabel: string;
    disabled?: boolean;
    actions?: ReactNode;
    className?: string;
}

/** Reusable, single-line attachment card. Consumer-specific actions are injected. */
const AttachmentItem = ({name, leadingIcon, onOpen, openLabel, disabled = false, actions, className = ''}: AttachmentItemProps) => <div className={`attachment-item${className ? ` ${className}` : ''}`}>
    <button type="button" className="attachment-item-open" disabled={disabled} aria-label={openLabel} onClick={onOpen}>
        {leadingIcon}
        <span>{name}</span>
    </button>
    {actions}
</div>;

export default AttachmentItem;
