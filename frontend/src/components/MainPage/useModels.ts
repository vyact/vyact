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
    const [dflash2Supported, setDflash2Supported] = useState<string[]>([]);
    const [dflash2Active, setDflash2Active] = useState<string | null>(null);
    const [visionSupported, setVisionSupported] = useState<string[]>([]);
    const [audioSupported, setAudioSupported] = useState<string[]>([]);
    const [selectedModel, setSelectedModel] = useState<string>('');
    const [isImageMode, setIsImageMode] = useState(false);
    const [modelType, setModelType] = useState<'chat' | 'image_gen' | 'image_edit'>('chat');
    const [isModelLoading, setIsModelLoading] = useState(false);
    const [loadingModel, setLoadingModel] = useState('');
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

    const setModelLoading = (loading: boolean, model: string = '') => {
        setIsModelLoading(loading);
        setLoadingModel(loading ? model : '');
    };

    const refreshModels = async () => {
        try {
            const modelData = await api.getModels();
            setInstalled(modelData.installed || []);
            setMtpSupported(modelData.mtp_supported || []);
            setMtpActive(modelData.mtp_active || null);
            setDflash2Supported(modelData.dflash2_supported || []);
            setDflash2Active(modelData.dflash2_active || null);
            setVisionSupported(modelData.vision_supported || []);
            setAudioSupported(modelData.audio_supported || []);
            const initialModel = modelData.current || modelData.installed?.[0] || '';
            setSelectedModel(initialModel);
            onModelChange?.(initialModel);
            applyModelType(initialModel, modelData.model_type);
        } catch (error) {
            console.error('Failed to load models:', error);
        }
    };

    const handleModelChange = async (model: string, needsDownload: boolean = false, selectedType?: 'chat' | 'image_gen' | 'image_edit') => {
        if (!model || model === selectedModel || isModelLoading) return;

        if (needsDownload) {
            const confirmed = requestDownloadConfirmation
                ? await requestDownloadConfirmation(model)
                : false;
            if (!confirmed) return;
        }

        onBeforeModelChange?.();
        setModelLoading(true, model);
        if (needsDownload) {
            setIsDownloading(true);
            setDownloadingModel(model);
            setDownloadProgress(0);
            setDownloadMessage('');
            setIsModelLoadingIntoMemory(false);
        }

        try {
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
            setModelLoading(false);
            setIsDownloading(false);
        }
    };

    return {
        installed, mtpSupported, mtpActive, dflash2Supported, dflash2Active, visionSupported, audioSupported, selectedModel, isImageMode, modelType,
        isModelLoading, loadingModel, isDownloading, downloadingModel, downloadProgress, downloadMessage, isModelLoadingIntoMemory,
        setModelLoading,
        setIsDownloading, setDownloadingModel, setDownloadProgress, setDownloadMessage,
        refreshModels, handleModelChange,
    };
}
