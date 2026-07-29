import React, {useEffect, useState} from 'react';
import { useTranslation } from 'react-i18next';
import ModalOverlay from '../common/ModalOverlay/ModalOverlay';

interface DownloadModalProps {
    modelName: string;
    progress: number;
    message: string;
    isLoadingIntoMemory: boolean;
}

const DownloadModal: React.FC<DownloadModalProps> = ({ modelName, progress, message, isLoadingIntoMemory }) => {
    const { t } = useTranslation('main');
    const [loadingSeconds, setLoadingSeconds] = useState(0);

    useEffect(() => {
        if (!isLoadingIntoMemory) {
            setLoadingSeconds(0);
            return;
        }

        const startedAt = Date.now();
        const intervalId = window.setInterval(() => {
            setLoadingSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1000);
        return () => window.clearInterval(intervalId);
    }, [isLoadingIntoMemory]);

    return (
        <ModalOverlay className="download-modal-overlay">
            <div className="download-modal">
                <h3>{modelName}</h3>
                <p className="download-subtitle">
                    {isLoadingIntoMemory
                        ? t('modelDownload.loadingIntoMemory', {seconds: loadingSeconds})
                        : t('modelDownload.downloading')}
                </p>
                <div className="download-progress-bar">
                    <div className="download-progress-fill" style={{ width: `${progress}%` }}/>
                </div>
                {message && <div className="download-message">{message}</div>}
                <div className="download-percent">{progress}%</div>
            </div>
        </ModalOverlay>
    );
};

export default DownloadModal;
