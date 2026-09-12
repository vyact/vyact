import {FileText} from 'lucide-react';
import AttachmentItem from '../common/AttachmentItem/AttachmentItem';
import {canPreviewDocument, useDocumentPreview} from '../../contexts/DocumentPreviewContext';
import './DocumentPreviewPanel.css';

export default function DocumentAttachmentCard({name, url, meta}: {name: string; url?: string; meta?: string}) {
    const {openDocument} = useDocumentPreview();
    const icon = <span className="user-file-card__icon" aria-hidden="true"><FileText size={16}/></span>;
    if (!url || !canPreviewDocument(name)) {
        return <div className="user-file-card">{icon}<span className="user-file-card__name">{name}</span>
            {meta && <span className="user-file-card__meta">{meta}</span>}
        </div>;
    }
    return <AttachmentItem name={name} leadingIcon={icon} openLabel={name}
        onOpen={() => openDocument({name, url})} className="document-attachment-card"/>;
}
