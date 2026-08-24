import { useState } from 'react';
import { api } from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';

export const IMAGE_MODEL_IDS: string[] = [];
export const IMAGE_EDIT_IDS: string[] = [];

export function useModels(
    onModelChange?: (model: string) => void,
    requestDownloadConfirmation?: (model: string) => Promise<boolean>,
    onBeforeModelChange?: () => void,
) {
    const [installed, setInstalled] = useState<string[]>([]);
    const [mtpSupported, setMtpSupported] = useState<string[]>([]);
    const [mtpActive, setMtpActive] = useState<string | null>(null);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [isImageMode, setIsImageMode] = useState(false);
    const [modelType, setModelType] = useState<'chat' | 'image_gen' | 'image_edit'>('chat');
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [isDownloading, setIsDownloading] = useState(false);
    const [downloadingModel, setDownloadingModel] = useState('');
    const [downloadProgress, setDownloadProgress] = useState(0);
    const [downloadMessage, setDownloadMessage] = useState('');
    const [isModelLoadingIntoMemory, setIsModelLoadingIntoMemory] = useState(false);

    const applyModelType = (model: string, selectedType?: 'chat' | 'image_gen' | 'image_edit') => {
        if (selectedType) {
            setIsImageMode(selectedType !== 'chat');
            setModelType(selectedType);
            return;
        }
        const isImg = IMAGE_MODEL_IDS.includes(model);
        const mType = IMAGE_EDIT_IDS.includes(model) ? 'image_edit' : isImg ? 'image_gen' : 'chat';
        setIsImageMode(isImg);
        setModelType(mType as 'chat' | 'image_gen' | 'image_edit');
    };

    const refreshModels = async () => {
        try {
            const modelData = await api.getModels();
            setInstalled(modelData.installed || []);
            setMtpSupported(modelData.mtp_supported || []);
            setMtpActive(modelData.mtp_active || null);
            const initialModel = modelData.current || modelData.installed?.[0] || '';
            setSelectedModel(initialModel);
            onModelChange?.(initialModel);
            applyModelType(initialModel, modelData.model_type);
        } catch (error) {
            console.error('Failed to load models:', error);
        }
    };

    const handleModelChange = async (model: string, needsDownload: boolean = false, selectedType?: 'chat' | 'image_gen' | 'image_edit') => {
        if (!model || isModelLoading) return;

        if (needsDownload) {
            const confirmed = requestDownloadConfirmation
                ? await requestDownloadConfirmation(model)
                : false;
            if (!confirmed) return;
        }

        onBeforeModelChange?.();
        setIsModelLoading(true);
        if (needsDownload) {
            setIsDownloading(true);
            setDownloadingModel(model);
            setDownloadProgress(0);
            setDownloadMessage('');
            setIsModelLoadingIntoMemory(false);
        }

        try {
            setSelectedModel(model);
            await api.selectModel('vyact', model, undefined, (message: string, type: string, progress?: number) => {
                if (needsDownload && progress !== undefined) {
                    setDownloadProgress(progress);
                    setIsModelLoadingIntoMemory(type === 'model_loading');
                    setDownloadMessage(type === 'log' ? message : '');
                }
            }, selectedType);
            await refreshModels();
            applyModelType(model, selectedType);
            onModelChange?.(model);
        } catch (error) {
            console.error('Model change failed:', error);
            toast.error('모델 변경 실패', String(error));
        } finally {
            setIsModelLoading(false);
            setIsDownloading(false);
        }
    };

    return {
        installed, mtpSupported, mtpActive, selectedModel, isImageMode, modelType,
        isModelLoading, isDownloading, downloadingModel, downloadProgress, downloadMessage, isModelLoadingIntoMemory,
        setIsDownloading, setDownloadingModel, setDownloadProgress, setDownloadMessage,
        refreshModels, handleModelChange,
    };
}
