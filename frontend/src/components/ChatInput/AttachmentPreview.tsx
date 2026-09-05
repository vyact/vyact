import {formatLocalizedNumber} from '../../utils/localizedNumber';
import React from 'react';
import { Braces, FileText, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useCodePanel } from '../../contexts/CodePanelContext';
import type { PastedText, FileAttachment } from './useAttachments';

interface AttachmentPreviewProps {
    images: File[];
    fileAttachments: FileAttachment[];
    pastedTexts: PastedText[];
    modelType: 'chat' | 'image_gen' | 'image_edit';
    onRemoveImage: (index: number) => void;
    onRemoveFile: (index: number) => void;
    onRemovePastedText: (id: string) => void;
    onImageClick: (index: number) => void;
}

const formatFileSize = (size: number) => {
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
    return `${formatLocalizedNumber(size / (1024 * 1024), 1)} MB`;
};

const AttachmentPreview: React.FC<AttachmentPreviewProps> = ({
                                                                 images, fileAttachments, pastedTexts, modelType,
                                                                 onRemoveImage, onRemoveFile, onRemovePastedText, onImageClick,
                                                             }) => {
    const { openPanel } = useCodePanel();
    const { t, i18n } = useTranslation('main');

    if ((images.length === 0 && fileAttachments.length === 0 && pastedTexts.length === 0) || modelType === 'image_gen') return null;

    const handlePastedTextClick = (p: PastedText) => {
        const firstLine = p.content.split('\n')[0].trim();
        const langMap: [string, string][] = [
            ['import ', 'tsx'], ['from ', 'tsx'], ['const ', 'tsx'], ['function ', 'tsx'],
            ['def ', 'python'], ['class ', 'tsx'], ['public ', 'java'], ['package ', 'java'],
            ['#', 'python'], ['<', 'html'],
        ];
        const lang = langMap.find(([k]) => firstLine.startsWith(k))?.[1] || 'text';
        openPanel([{ name: p.label, lang, code: p.content }], 0, p.id);
    };

    return (
        <div className="attachment-preview-list">
            {pastedTexts.map(p => (
                <div key={p.id} className="pasted-text-preview">
                    <div
                        onClick={() => handlePastedTextClick(p)}
                        className="pasted-text-preview__content"
                    >
                        <span className="pasted-text-preview__icon"><Braces size={18}/></span>
                        <div className="pasted-text-preview__copy">
                            <span className="pasted-text-preview__title">{p.label}</span>
                            <span className="pasted-text-preview__meta">{t('message.pastedText')} · {t('uiAuditFinal.characterCount', {count: p.content.length.toLocaleString(i18n.resolvedLanguage || i18n.language)})} · {t('attachmentPreview.analysis')}</span>
                        </div>
                    </div>
                    <button className="pasted-text-preview__remove" onClick={e => { e.stopPropagation(); onRemovePastedText(p.id); }} aria-label={t('sidebar.delete')}>
                        <X size={10}/>
                    </button>
                </div>
            ))}
            {images.map((img, idx) => (
                <div key={`img-${idx}`} className="image-attachment-preview">
                    <img
                        src={URL.createObjectURL(img)}
                        alt={`preview-${idx}`}
                        onClick={() => onImageClick(idx)}
                        className="image-attachment-preview__image"
                    />
                    <button className="attachment-remove-btn attachment-remove-btn--image" onClick={() => onRemoveImage(idx)} aria-label={t('sidebar.delete')}>
                        <X size={10}/>
                    </button>
                </div>
            ))}
            {fileAttachments.map((fa, idx) => (
                <div key={`file-${idx}`} className="file-attachment-preview">
                    <span className="file-attachment-preview__icon" aria-hidden="true">
                        <FileText size={20}/>
                    </span>
                    <span className="file-attachment-preview__copy">
                        <span className="file-attachment-preview__name">
                            {fa.file.name}
                        </span>
                        <span className="file-attachment-preview__meta">
                            {(fa.file.name.split('.').pop() || t('attachmentPreview.analysis')).toUpperCase()}
                            {' · '}
                            {formatFileSize(fa.file.size)}
                        </span>
                    </span>
                    <button
                        className="attachment-remove-btn attachment-remove-btn--file"
                        onClick={() => onRemoveFile(idx)}
                        aria-label={t('sidebar.delete')}
                    >
                        <X size={10}/>
                    </button>
                </div>
            ))}
        </div>
    );
};

export default AttachmentPreview;
