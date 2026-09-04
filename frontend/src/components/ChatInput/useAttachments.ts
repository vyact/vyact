import {useCallback, useEffect, useRef, useState} from 'react';
import {useTranslation} from 'react-i18next';
import {isAudioChatFile, isSupportedChatFile} from '../../utils/fileValidation';
import {toast} from '../common/ToastNotifications/ToastNotifications';

// 붙여넣기 텍스트를 chip으로 처리할 최소 기준
// (긴 한 줄짜리 지시문 — 예: 영어 스크립트 생성 형식 지정 등 — 이 첨부로 빠지지 않도록
// 글자 수 기준을 여유 있게 잡는다. 실제 대량 텍스트/코드 붙여넣기는 대부분 400자를
// 훌쩍 넘기거나 여러 줄이므로 PASTE_MIN_LINES 조건으로도 충분히 걸러진다.)
const PASTE_MIN_CHARS = 300;
const PASTE_MIN_LINES = 6;

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

    // 외부 드롭 파일 처리
    useEffect(() => {
        if (externalDropFiles.length > 0 && modelType !== 'image_gen') {
            const supportedFiles = filterSupportedFiles(externalDropFiles);
            const imgs = supportedFiles.filter(f => f.type.startsWith('image/'));
            const files = supportedFiles.filter(f => !f.type.startsWith('image/'));
            if (imgs.length > 0) {
                setImages(prev => [...prev, ...imgs].slice(0, 5));
            }
            if (files.length > 0) setFileAttachments(prev => [...prev, ...files.map(f => ({ file: f }))].slice(0, 5));
            onExternalDropHandled?.();
        }
    }, [externalDropFiles, filterSupportedFiles, modelType, onExternalDropHandled]);

    // 대화 전환 시 초기화
    useEffect(() => {
        if (resetTrigger && resetTrigger > 0) {
            setImages([]);
            setFileAttachments([]);
            setPastedTexts([]);
        }
    }, [resetTrigger]);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = filterSupportedFiles(Array.from(e.target.files || []));
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        const otherFiles = files.filter(f => !f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
            setImages(prev => [...prev, ...imageFiles].slice(0, 5));
        }
        if (otherFiles.length > 0) setFileAttachments(prev => [...prev, ...otherFiles.map(f => ({ file: f }))].slice(0, 5));
        if (fileInputRef.current) fileInputRef.current.value = '';
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        if (modelType === 'image_gen') return;
        const items = e.clipboardData?.items;
        if (!items) return;

        // 이미지 붙여넣기
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file && filterSupportedFiles([file]).length > 0) {
                    setImages(prev => [...prev, file].slice(0, 5));
                }
                return;
            }
        }

        // 텍스트 붙여넣기 — 긴 텍스트면 chip으로
        const text = e.clipboardData.getData('text');
        if (text && (text.length >= PASTE_MIN_CHARS || text.split('\n').length >= PASTE_MIN_LINES)) {
            e.preventDefault();
            const firstLine = text.split('\n').find(l => l.trim()) || text;
            const label = firstLine.trim().slice(0, 80) + (firstLine.length > 80 ? '...' : '');
            const id = `paste-${Date.now()}`;
            setPastedTexts(prev => [...prev, { id, label, content: text }]);
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
        images, fileAttachments, pastedTexts, fileInputRef,
        handleFileSelect, handlePaste,
        removeImage, removeFileAttachment, removePastedText, clearAll,
        setImages, setFileAttachments, setPastedTexts,
    };
}
