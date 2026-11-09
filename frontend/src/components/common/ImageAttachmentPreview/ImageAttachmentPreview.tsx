import {useEffect, useMemo} from 'react';
import {X} from 'lucide-react';
import {useTranslation} from 'react-i18next';
import './ImageAttachmentPreview.css';

export default function ImageAttachmentPreview({src, file, alt, disabled = false, onOpen, onRemove}: {
    src?: string; file?: File; alt: string; disabled?: boolean; onOpen: () => void; onRemove: () => void;
}) {
    const {t} = useTranslation('main');
    const imageUrl = useMemo(() => file ? URL.createObjectURL(file) : src, [file, src]);
    useEffect(() => () => {if (file && imageUrl) URL.revokeObjectURL(imageUrl);}, [file, imageUrl]);
    return <div className="image-attachment-preview">
        <button type="button" className="image-attachment-preview__open" aria-label={alt} onClick={onOpen}>
            <img src={imageUrl} alt={alt} className="image-attachment-preview__image"/>
        </button>
        <button type="button" className="attachment-remove-btn attachment-remove-btn--image" disabled={disabled}
            onClick={onRemove} aria-label={t('sidebar.delete')}><X size={10}/></button>
    </div>;
}
