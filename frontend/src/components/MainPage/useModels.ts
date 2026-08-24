import { useState } from 'react';
import { api } from '../../services/api';
import {toast} from '../common/ToastNotifications/ToastNotifications';

export const IMAGE_MODEL_IDS = ['x/flux2-klein:9b', 'x/z-image-turbo:latest'];
export const IMAGE_EDIT_IDS = ['x/flux2-klein:9b'];

const OLLAMA_PROGRESS_PATTERN = /(\d{1,3})%(?!\d)/g;

function getOllamaDownloadProgress(message: string): number | undefined {
    const matches = [...message.matchAll(OLLAMA_PROGRESS_PATTERN)];
    const lastMatch = matches[matches.length - 1]?.[1];
    if (!lastMatch) return undefined;

    // Ollama는 개별 레이어 전송이 끝나면 100%를 출력하지만, 이후에도
    // 검증·압축 해제·매니페스트 반영을 수행한다. pull 프로세스가 종료된 뒤에만
    // 메모리 로드 단계(100%)로 전환되므로 중간 상태는 99%로 유지한다.
    return Math.min(Number(lastMatch), 99);
}

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
            await api.selectModel('ollama', model, undefined, (message: string, type: string, progress?: number) => {
                if (needsDownload && progress !== undefined) {
                    const actualDownloadProgress = type === 'log'
                        ? getOllamaDownloadProgress(message)
                        : undefined;

                    // 이전 서버가 고정 70%를 보내더라도, Ollama 로그에 있는 실제 값을 우선한다.
                    if (actualDownloadProgress !== undefined) {
                        setDownloadProgress(actualDownloadProgress);
                    } else if (type === 'model_loading') {
                        setDownloadProgress(100);
                    }
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
