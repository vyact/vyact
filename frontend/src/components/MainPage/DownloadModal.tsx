import React from 'react';
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

    return (
        <ModalOverlay className="download-modal-overlay">
            <div className="download-modal">
                <h3>{modelName}</h3>
                <p className="download-subtitle">
                    {isLoadingIntoMemory ? t('modelDownload.loadingIntoMemory') : t('modelDownload.downloading')}
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
