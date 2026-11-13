import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {isAudioChatFile, isSupportedChatFile} from '../../utils/fileValidation';
import {toast} from '../common/ToastNotifications/ToastNotifications';

// 붙여넣기 텍스트가 글자 수 또는 줄 수 기준을 충족하면 첨부 카드로 처리한다.
const PASTE_MIN_CHARS = 600;
const PASTE_MIN_LINES = 7;
const MAX_FILE_ATTACHMENTS = 10;
const MAX_IMAGE_ATTACHMENTS = 5;

export interface PastedText {
    id: string;
    label: string;  // 첫 줄 또는 앞 30자
    content: string;
}

export interface FileAttachment {
    file: File;
}

export function useAttachments(
    modelType: 'chat' | 'image_gen' | 'image_edit',
    externalDropFiles: File[],
    onExternalDropHandled?: () => void,
    resetTrigger?: number,
    supportsImageInput = true,
    supportsAudioInput = true
) {
    const {t} = useTranslation('main');
    const [images, setImages] = useState<File[]>([]);
    const [fileAttachments, setFileAttachments] = useState<FileAttachment[]>([]);
    const [pastedTexts, setPastedTexts] = useState<PastedText[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const addPastedText = useCallback((text: string, customLabel?: string) => {
        const firstLine = text.split('\n').find(line => line.trim()) || text;
        const label = customLabel || firstLine.trim().slice(0, 80) + (firstLine.length > 80 ? '...' : '');
        setPastedTexts(previous => [...previous, {id: `paste-${crypto.randomUUID()}`, label, content: text}]);
    }, []);

    const isMediaSupported = useCallback((file: File) => {
        if (file.type.startsWith('image/') && !supportsImageInput) return false;
        if (isAudioChatFile(file) && !supportsAudioInput) return false;
        return true;
    }, [supportsImageInput, supportsAudioInput]);

    const warnUnsupportedMedia = useCallback((files: File[]) => {
        if (files.some(file => file.type.startsWith('image/') && !isMediaSupported(file))) {
            toast.warning(t('fileUpload.imageNotSupported'));
        }
        if (files.some(file => !file.type.startsWith('image/') && !isMediaSupported(file))) {
            toast.warning(t('fileUpload.audioNotSupported'));
        }
    }, [isMediaSupported, t]);

    const filterSupportedFiles = useCallback((selectedFiles: File[]) => {
        const unsupportedFile = selectedFiles.find(file => !isSupportedChatFile(file));
        if (unsupportedFile) {
            toast.warning(t('documentModal.unsupportedFormat', {name: unsupportedFile.name}));
        }
        warnUnsupportedMedia(selectedFiles);
        return selectedFiles.filter(file => isSupportedChatFile(file) && isMediaSupported(file));
    }, [t, isMediaSupported, warnUnsupportedMedia]);

    const addFiles = useCallback((selectedFiles: File[]) => {
        if (modelType === 'image_gen') return;
        const supportedFiles = filterSupportedFiles(selectedFiles);
        const imageFiles = supportedFiles.filter(file => file.type.startsWith('image/'));
        const otherFiles = supportedFiles.filter(file => !file.type.startsWith('image/'));
        if (imageFiles.length > 0) setImages(previous => [...previous, ...imageFiles].slice(0, MAX_IMAGE_ATTACHMENTS));
        if (otherFiles.length > 0) setFileAttachments(previous => [...previous, ...otherFiles.map(file => ({file}))].slice(0, MAX_FILE_ATTACHMENTS));
    }, [filterSupportedFiles, modelType]);

    // 파일 선택과 드롭에서 같은 검증 및 개수 제한을 적용한다.
    useEffect(() => {
        if (externalDropFiles.length > 0 && modelType !== 'image_gen') {
            addFiles(externalDropFiles);
            onExternalDropHandled?.();
        }
    }, [externalDropFiles, addFiles, modelType, onExternalDropHandled]);

    // 대화 전환 시 초기화
    useEffect(() => {
        if (resetTrigger && resetTrigger > 0) {
            setImages([]);
            setFileAttachments([]);
            setPastedTexts([]);
        }
    }, [resetTrigger]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        addFiles(Array.from(e.target.files || []));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: Pick<React.ClipboardEvent<HTMLTextAreaElement>, 'clipboardData' | 'preventDefault'> | ClipboardEvent) => {
        if (modelType === 'image_gen') return;
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;
        const items = clipboardData.items;

        // 클립보드에 여러 이미지가 있으면 모두 추가한다.
        const imageFiles = Array.from(items)
            .filter(item => item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter((file): file is File => file !== null);
        if (imageFiles.length > 0) {
            e.preventDefault();
            addFiles(imageFiles);
            return;
        }

        // 텍스트 붙여넣기 — 긴 텍스트면 chip으로
        const text = clipboardData.getData('text');
        if (text && (text.length >= PASTE_MIN_CHARS || text.split('\n').length >= PASTE_MIN_LINES)) {
            e.preventDefault();
            addPastedText(text);
        }
    };

    const removePastedText = (id: string) => setPastedTexts(prev => prev.filter(p => p.id !== id));
    const removeImage = (index: number) => {
        setImages(prev => prev.filter((_, i) => i !== index));
    };
    const removeFileAttachment = (index: number) => setFileAttachments(prev => prev.filter((_, i) => i !== index));
    const clearAll = () => { setImages([]); setFileAttachments([]); setPastedTexts([]); };

    const validateAttachments = () => {
        const files = [...images, ...fileAttachments.map(attachment => attachment.file)];
        warnUnsupportedMedia(files);
        return files.every(isMediaSupported);
    };

    return {
        validateAttachments,
        images, fileAttachments, pastedTexts, fileInputRef, addPastedText,
        addFiles, handleFileSelect, handlePaste,
        removeImage, removeFileAttachment, removePastedText, clearAll,
        setImages, setFileAttachments, setPastedTexts,
    };
}
